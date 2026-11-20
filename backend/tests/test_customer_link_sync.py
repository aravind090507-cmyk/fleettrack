"""
Verification suite for Customer Tracking Link synchronization between
Driver Console and Manager Portal.

Tests:
1. Driver starts delivery -> receives public tracking link.
2. Manager retrieves delivery assignment -> Customer Link exactly matches Driver's tracking link.
3. Both links resolve via GET /api/track/{token} and display the same vehicle, driver, and journey data.
4. Completing/ending the journey revokes the link (returns 410 Gone).
5. Starting a subsequent journey generates a distinct new tracking link correctly associated.
6. Simultaneous deliveries with multiple drivers maintain strictly isolated, non-conflicting tracking links.
"""
import pytest
import pytest_asyncio
import uuid
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.security.passwords import hash_password


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()


@pytest.mark.asyncio
async def test_customer_link_exact_sync(auth_headers_factory):
    async with AsyncSessionLocal() as db:
        comp = Company(name="Sync Logistics Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Dispatch Manager",
            email=f"mgr_{uuid.uuid4().hex[:6]}@synclogistics.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver1 = User(
            company_id=comp.id,
            name="Driver Alpha",
            email=f"drv1_{uuid.uuid4().hex[:6]}@synclogistics.com",
            password_hash=hash_password("Pass123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        driver2 = User(
            company_id=comp.id,
            name="Driver Beta",
            email=f"drv2_{uuid.uuid4().hex[:6]}@synclogistics.com",
            password_hash=hash_password("Pass123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        veh1 = Vehicle(
            company_id=comp.id,
            registration_number=f"MH-02-AL-{uuid.uuid4().hex[:4].upper()}",
            model="Delivery Van Alpha",
            vehicle_type="VAN",
            status="AVAILABLE",
        )
        veh2 = Vehicle(
            company_id=comp.id,
            registration_number=f"MH-02-BE-{uuid.uuid4().hex[:4].upper()}",
            model="Delivery Truck Beta",
            vehicle_type="TRUCK",
            status="AVAILABLE",
        )
        db.add_all([manager, driver1, driver2, veh1, veh2])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver1)
        await db.refresh(driver2)
        await db.refresh(veh1)
        await db.refresh(veh2)

    mgr_headers = auth_headers_factory(manager)
    drv1_headers = auth_headers_factory(driver1)
    drv2_headers = auth_headers_factory(driver2)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Step 1: Manager creates a delivery assignment for Driver 1
        asg1_payload = {
            "driver_id": driver1.id,
            "destination_name": "Andheri West Client Hub",
            "destination_lat": 19.1363,
            "destination_lng": 72.8277,
            "instructions": "Fragile shipment — verify recipient signature",
        }
        res_create1 = await client.post("/api/dispatch/assignments", json=asg1_payload, headers=mgr_headers)
        assert res_create1.status_code == 201
        asg1_id = res_create1.json()["id"]

        # Step 2: Driver 1 accepts the assignment
        res_acc1 = await client.post(f"/api/driver/assignments/{asg1_id}/accept", headers=drv1_headers)
        assert res_acc1.status_code == 200
        assert res_acc1.json()["status"] == "ACCEPTED"

        # Step 3: Driver 1 starts the delivery
        start1_payload = {
            "origin_name": "Mumbai Central Depot",
            "origin_lat": 18.9696,
            "origin_lng": 72.8193,
        }
        res_start1 = await client.post(f"/api/driver/assignments/{asg1_id}/start", json=start1_payload, headers=drv1_headers)
        assert res_start1.status_code == 200
        start1_data = res_start1.json()

        driver1_tracking_url = start1_data["tracking_url"]
        driver1_tracking_token = start1_data["tracking_token"]
        assert driver1_tracking_url is not None
        assert driver1_tracking_url.startswith("/track/")
        assert driver1_tracking_token in driver1_tracking_url

        # Step 4: Driver re-fetches active delivery (simulating driver refresh)
        res_drv_active = await client.get("/api/driver/assignments/active", headers=drv1_headers)
        assert res_drv_active.status_code == 200
        drv_active_data = res_drv_active.json()
        assert drv_active_data["tracking_url"] == driver1_tracking_url

        # Step 5: Manager opens Delivery Monitoring and selects the IN TRANSIT delivery
        res_mgr_asg1 = await client.get(f"/api/dispatch/assignments/{asg1_id}", headers=mgr_headers)
        assert res_mgr_asg1.status_code == 200
        mgr_asg1_data = res_mgr_asg1.json()

        # Step 6: Verify Manager Portal Customer Link EXACTLY matches Driver Console tracking link!
        manager1_customer_link = mgr_asg1_data["tracking_url"]
        assert manager1_customer_link is not None
        assert manager1_customer_link == driver1_tracking_url, (
            f"Customer Link mismatch! Manager got '{manager1_customer_link}' but Driver has '{driver1_tracking_url}'"
        )

        # Step 7: Verify manager list endpoint also returns the exact same link
        res_mgr_list = await client.get("/api/dispatch/assignments", headers=mgr_headers)
        assert res_mgr_list.status_code == 200
        found_in_list = next((a for a in res_mgr_list.json() if a["id"] == asg1_id), None)
        assert found_in_list is not None
        assert found_in_list["tracking_url"] == driver1_tracking_url

        # Step 8: Open both links via Public Tracking API and verify identical journey data
        raw_token1 = manager1_customer_link.split("/track/")[1]
        res_public = await client.get(f"/api/track/{raw_token1}")
        assert res_public.status_code == 200, f"Public tracking link failed: {res_public.text}"
        pub_data = res_public.json()
        assert pub_data["destination_name"] == "Andheri West Client Hub"
        assert pub_data["driver_name"] == "Driver Alpha"
        assert pub_data["status"] == "IN_PROGRESS"

        # Step 9: Simulate concurrent Delivery for Driver 2
        asg2_payload = {
            "driver_id": driver2.id,
            "destination_name": "Bandra Kurla Complex Block G",
            "destination_lat": 19.0657,
            "destination_lng": 72.8687,
            "instructions": "Deliver to reception desk",
        }
        res_create2 = await client.post("/api/dispatch/assignments", json=asg2_payload, headers=mgr_headers)
        assert res_create2.status_code == 201
        asg2_id = res_create2.json()["id"]

        await client.post(f"/api/driver/assignments/{asg2_id}/accept", headers=drv2_headers)
        res_start2 = await client.post(f"/api/driver/assignments/{asg2_id}/start", json={
            "origin_name": "Kurla Depot",
            "origin_lat": 19.0726,
            "origin_lng": 72.8845,
        }, headers=drv2_headers)
        assert res_start2.status_code == 200
        driver2_tracking_url = res_start2.json()["tracking_url"]

        # Verify links are strictly distinct between Driver 1 and Driver 2
        assert driver1_tracking_url != driver2_tracking_url

        res_mgr_asg2 = await client.get(f"/api/dispatch/assignments/{asg2_id}", headers=mgr_headers)
        assert res_mgr_asg2.status_code == 200
        assert res_mgr_asg2.json()["tracking_url"] == driver2_tracking_url

        # Step 10: Complete Delivery 1 -> Verify link revocation
        res_complete1 = await client.post(f"/api/driver/assignments/{asg1_id}/complete", headers=drv1_headers)
        assert res_complete1.status_code == 200
        assert res_complete1.json()["status"] == "COMPLETED"

        # Manager portal assignment no longer has an active customer tracking url
        res_mgr_after = await client.get(f"/api/dispatch/assignments/{asg1_id}", headers=mgr_headers)
        assert res_mgr_after.status_code == 200
        assert res_mgr_after.json()["tracking_url"] is None

        # Public tracking endpoint returns 410 Gone
        res_revoked = await client.get(f"/api/track/{raw_token1}")
        assert res_revoked.status_code == 410

        # Step 11: Subsequent Delivery for Driver 1 gets a distinct new tracking link
        asg3_payload = {
            "driver_id": driver1.id,
            "destination_name": "Navi Mumbai Express Terminal",
            "destination_lat": 19.0330,
            "destination_lng": 73.0297,
        }
        res_create3 = await client.post("/api/dispatch/assignments", json=asg3_payload, headers=mgr_headers)
        asg3_id = res_create3.json()["id"]

        await client.post(f"/api/driver/assignments/{asg3_id}/accept", headers=drv1_headers)
        res_start3 = await client.post(f"/api/driver/assignments/{asg3_id}/start", json={}, headers=drv1_headers)
        driver1_new_tracking_url = res_start3.json()["tracking_url"]

        assert driver1_new_tracking_url != driver1_tracking_url
        res_mgr_asg3 = await client.get(f"/api/dispatch/assignments/{asg3_id}", headers=mgr_headers)
        assert res_mgr_asg3.json()["tracking_url"] == driver1_new_tracking_url
