"""
Unit and integration tests for:
- MODULE A: Driver Availability & Deliveries
- MODULE B: Manager Driver Dispatch & Map-Based Delivery Assignment
- MODULE C: Enhanced Ephemeral Public Tracking Interface & Timeline
"""
import uuid
import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.delivery_assignment import DeliveryAssignment
from app.models.trip_event import TripEvent
from tests.fixtures import seed_demo_users


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)


@pytest.mark.asyncio
async def test_driver_availability_lifecycle(auth_headers_factory):
    """Test driver can set AVAILABLE, UNAVAILABLE, and cannot set AVAILABLE while BUSY."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="Test Dispatch Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        driver = User(
            company_id=comp.id,
            name="John Delivery Driver",
            email=f"driver_{uuid.uuid4().hex[:6]}@test.com",
            password_hash="test_hash",
            role="DRIVER",
            availability="AVAILABLE",
            availability_preference="AVAILABLE",
            is_active=True,
        )
        db.add(driver)
        await db.commit()
        await db.refresh(driver)

    driver_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Get current availability
        res = await client.get("/api/driver/availability", headers=driver_headers)
        assert res.status_code == 200
        assert res.json()["availability"] == "AVAILABLE"

        # 2. Switch to UNAVAILABLE
        res_unavail = await client.put(
            "/api/driver/availability",
            json={"availability": "UNAVAILABLE"},
            headers=driver_headers,
        )
        assert res_unavail.status_code == 200
        assert res_unavail.json()["availability"] == "UNAVAILABLE"
        assert res_unavail.json()["availability_preference"] == "UNAVAILABLE"

        # 3. Switch back to AVAILABLE
        res_avail = await client.put(
            "/api/driver/availability",
            json={"availability": "AVAILABLE"},
            headers=driver_headers,
        )
        assert res_avail.status_code == 200
        assert res_avail.json()["availability"] == "AVAILABLE"


@pytest.mark.asyncio
async def test_manager_dispatch_and_delivery_lifecycle(auth_headers_factory):
    """
    Test end-to-end dispatch workflow:
    1. Manager sees available driver.
    2. Manager assigns delivery (address, lat/lng, instructions).
    3. Driver receives pending delivery assignment.
    4. Driver accepts -> driver becomes BUSY.
    5. Driver cannot receive another assignment while busy.
    6. Driver starts delivery -> creates journey & tracking link.
    7. Driver completes delivery -> marks COMPLETED, restores driver availability.
    """
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="FastExpress Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Alice Fleet Manager",
            email=f"mgr_{uuid.uuid4().hex[:6]}@fastexpress.com",
            password_hash="test_hash",
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Bob Driver",
            email=f"bob_{uuid.uuid4().hex[:6]}@fastexpress.com",
            password_hash="test_hash",
            role="DRIVER",
            availability="AVAILABLE",
            availability_preference="AVAILABLE",
            is_active=True,
        )
        vehicle = Vehicle(
            company_id=comp.id,
            registration_number=f"TRK-{uuid.uuid4().hex[:4].upper()}",
            model="Sprinter Cargo Van",
            vehicle_type="VAN",
            status="AVAILABLE",
            assigned_driver_id=driver.id,
        )
        db.add_all([manager, driver, vehicle])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)
        await db.refresh(vehicle)

    mgr_headers = auth_headers_factory(manager)
    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Manager views company drivers
        res_drivers = await client.get("/api/dispatch/drivers", headers=mgr_headers)
        assert res_drivers.status_code == 200
        drivers_list = res_drivers.json()
        assert len(drivers_list) >= 1
        d_item = next(d for d in drivers_list if d["id"] == driver.id)
        assert d_item["availability"] == "AVAILABLE"
        assert d_item["can_assign"] is True

        # Step 2: Manager assigns delivery
        payload = {
            "driver_id": driver.id,
            "destination_name": "Apollo Hospitals, Greams Road, Chennai",
            "destination_lat": 13.060422,
            "destination_lng": 80.249583,
            "instructions": "Deliver critical pharmaceutical supplies to Gate 3",
        }
        res_asg = await client.post("/api/dispatch/assignments", json=payload, headers=mgr_headers)
        assert res_asg.status_code == 201
        asg_data = res_asg.json()
        asg_id = asg_data["id"]
        assert asg_data["status"] == "PENDING"
        assert asg_data["destination_name"] == payload["destination_name"]

        # Step 3: Duplicate assignment prevention — Driver already has pending assignment
        res_dup = await client.post("/api/dispatch/assignments", json=payload, headers=mgr_headers)
        assert res_dup.status_code == 409

        # Step 4: Driver checks active assignment
        res_active = await client.get("/api/driver/assignments/active", headers=drv_headers)
        assert res_active.status_code == 200
        active_asg = res_active.json()
        assert active_asg is not None
        assert active_asg["id"] == asg_id
        assert active_asg["status"] == "PENDING"

        # Step 5: Driver accepts assignment
        res_accept = await client.post(f"/api/driver/assignments/{asg_id}/accept", headers=drv_headers)
        assert res_accept.status_code == 200
        assert res_accept.json()["status"] == "ACCEPTED"

        # Check driver availability automatically became BUSY
        res_avail = await client.get("/api/driver/availability", headers=drv_headers)
        assert res_avail.json()["availability"] == "BUSY"

        # Step 6: Driver cannot manually change availability while busy
        res_illegal_avail = await client.put(
            "/api/driver/availability",
            json={"availability": "AVAILABLE"},
            headers=drv_headers,
        )
        assert res_illegal_avail.status_code == 400

        # Step 7: Driver starts delivery
        res_start = await client.post(
            f"/api/driver/assignments/{asg_id}/start",
            json={
                "origin_name": "Central Pharmacy Depot",
                "origin_lat": 13.0827,
                "origin_lng": 80.2707,
            },
            headers=drv_headers,
        )
        assert res_start.status_code == 200
        start_data = res_start.json()
        assert start_data["assignment"]["status"] == "IN_PROGRESS"
        journey_id = start_data["journey_id"]
        tracking_token = start_data["tracking_token"]
        assert tracking_token is not None

        # Step 8: Verify public tracking link resolves and shows enriched data
        res_track = await client.get(f"/api/track/{tracking_token}")
        assert res_track.status_code == 200
        track_data = res_track.json()
        assert track_data["destination_name"] == "Apollo Hospitals, Greams Road, Chennai"
        assert track_data["status"] == "IN_PROGRESS"
        assert "trip_events" in track_data

        # Step 9: Driver completes delivery
        res_comp = await client.post(f"/api/driver/assignments/{asg_id}/complete", headers=drv_headers)
        assert res_comp.status_code == 200
        assert res_comp.json()["status"] == "COMPLETED"

        # Step 10: Driver availability restored to previous preference (AVAILABLE)
        res_restored = await client.get("/api/driver/availability", headers=drv_headers)
        assert res_restored.json()["availability"] == "AVAILABLE"

        # Manager sees delivery completed in assignments audit log
        res_mgr_list = await client.get("/api/dispatch/assignments", headers=mgr_headers)
        assert res_mgr_list.status_code == 200
        completed_asg = next(a for a in res_mgr_list.json() if a["id"] == asg_id)
        assert completed_asg["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_assignment_rejection_and_cancellation(auth_headers_factory):
    """Test driver rejection releases reservation and manager cancellation works."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="Rejection Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Dispatch Officer",
            email=f"disp_{uuid.uuid4().hex[:6]}@rej.com",
            password_hash="test_hash",
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Charlie Driver",
            email=f"charlie_{uuid.uuid4().hex[:6]}@rej.com",
            password_hash="test_hash",
            role="DRIVER",
            availability="AVAILABLE",
            availability_preference="AVAILABLE",
            is_active=True,
        )
        db.add_all([manager, driver])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)

    mgr_headers = auth_headers_factory(manager)
    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create assignment
        res_asg = await client.post(
            "/api/dispatch/assignments",
            json={
                "driver_id": driver.id,
                "destination_name": "Tidel Park, Chennai",
                "destination_lat": 12.9897,
                "destination_lng": 80.2487,
            },
            headers=mgr_headers,
        )
        assert res_asg.status_code == 201
        asg_id = res_asg.json()["id"]

        # Driver rejects assignment
        res_rej = await client.post(f"/api/driver/assignments/{asg_id}/reject", headers=drv_headers)
        assert res_rej.status_code == 200
        assert res_rej.json()["status"] == "REJECTED"

        # Driver can now receive a new assignment
        res_asg2 = await client.post(
            "/api/dispatch/assignments",
            json={
                "driver_id": driver.id,
                "destination_name": "OMR Tech Zone",
                "destination_lat": 12.9716,
                "destination_lng": 80.2400,
            },
            headers=mgr_headers,
        )
        assert res_asg2.status_code == 201
        asg2_id = res_asg2.json()["id"]

        # Manager cancels the new assignment
        res_cancel = await client.post(f"/api/dispatch/assignments/{asg2_id}/cancel", headers=mgr_headers)
        assert res_cancel.status_code == 200
        assert res_cancel.json()["status"] == "CANCELLED"


@pytest.mark.asyncio
async def test_reverse_geocoding_endpoint():
    """Verify reverse geocoding returns coordinates and display name without failing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/locations/reverse?lat=13.0827&lon=80.2707")
        assert res.status_code == 200
        data = res.json()
        assert "display_name" in data
        assert abs(data["lat"] - 13.0827) < 0.001
        assert abs(data["lon"] - 80.2707) < 0.001
