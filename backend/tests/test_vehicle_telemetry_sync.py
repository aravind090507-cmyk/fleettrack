"""
Integration test suite for Vehicle Telemetry Synchronization between Driver Dispatch and Manager Overview.
Verifies the complete 12-step lifecycle:
1. Manager checks initial vehicle status (AVAILABLE, Unassigned, No Route).
2. Manager assigns delivery in Dispatch.
3. Overview synchronizes: Driver name, BUSY status, Assigned Destination Route.
4. Driver accepts delivery.
5. Overview synchronizes: Driver remains BUSY, Assigned Destination Route.
6. Driver starts delivery.
7. Overview synchronizes: IN_TRANSIT status, Origin -> Destination Route, Live GPS coordinates.
8. Driver transmits live GPS telemetry pings.
9. Overview synchronizes: Latest speed and updated GPS coordinates.
10. Driver completes delivery.
11. Overview synchronizes: AVAILABLE status, Active Route cleared, 0 speed.
12. Multiple vehicles and drivers in the same company update independently without cross-contamination.
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
from app.security.passwords import hash_password
from app.security.jwt import create_access_token
from tests.fixtures import seed_demo_users


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)


@pytest.fixture
def auth_headers_factory():
    def _create_headers(user: User):
        token = create_access_token(
            data={
                "sub": user.id,
                "cid": user.company_id,
                "email": user.email,
                "role": user.role,
                "name": user.name,
            }
        )
        return {"Authorization": f"Bearer {token}"}
    return _create_headers


@pytest.mark.asyncio
async def test_vehicle_telemetry_synchronization_lifecycle(auth_headers_factory):
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="Sync Logistics Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Fleet Dispatch Manager",
            email=f"mgr_{uuid.uuid4().hex[:6]}@sync.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Rajesh Kumar",
            email=f"driver_{uuid.uuid4().hex[:6]}@sync.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            availability_preference="AVAILABLE",
            is_active=True,
        )
        db.add_all([manager, driver])
        await db.flush()

        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-02-SYNC-909",
            model="Mercedes Sprinter",
            vehicle_type="VAN",
            status="AVAILABLE",
            assigned_driver_id=driver.id,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)
        await db.refresh(vehicle)

    mgr_headers = auth_headers_factory(manager)
    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Initial State in Overview
        res_ov1 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov1.status_code == 200
        vehicles_ov1 = res_ov1.json()
        target_v1 = next((v for v in vehicles_ov1 if v["vehicle_id"] == vehicle.id), None)
        assert target_v1 is not None
        assert target_v1["status"] == "AVAILABLE"
        assert target_v1["assigned_driver_name"] == "Rajesh Kumar"
        assert target_v1["origin_name"] is None
        assert target_v1["destination_name"] is None

        # Step 2: Assign Delivery in Driver Dispatch
        dest_address = "Apollo Hospitals, Greams Road, Thousand Lights, Chennai 600006"
        assign_payload = {
            "driver_id": driver.id,
            "destination_name": dest_address,
            "destination_lat": 13.060422,
            "destination_lng": 80.249583,
            "instructions": "Deliver medical emergency supplies to Gate 2",
        }
        res_assign = await client.post("/api/dispatch/assignments", json=assign_payload, headers=mgr_headers)
        assert res_assign.status_code == 201
        asg_id = res_assign.json()["id"]

        # Step 3: Confirm Overview reflects Delivery Assignment (status BUSY, destination_name populated)
        res_ov2 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov2.status_code == 200
        target_v2 = next(v for v in res_ov2.json() if v["vehicle_id"] == vehicle.id)
        assert target_v2["status"] == "BUSY"
        assert target_v2["assigned_driver_name"] == "Rajesh Kumar"
        assert target_v2["destination_name"] == dest_address

        # Step 4: Driver Accepts Delivery Assignment
        res_accept = await client.post(f"/api/driver/assignments/{asg_id}/accept", headers=drv_headers)
        assert res_accept.status_code == 200

        # Step 5: Confirm Overview reflects Accepted Delivery (status BUSY, destination_name populated)
        res_ov3 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov3.status_code == 200
        target_v3 = next(v for v in res_ov3.json() if v["vehicle_id"] == vehicle.id)
        assert target_v3["status"] == "BUSY"
        assert target_v3["destination_name"] == dest_address

        # Step 6: Driver Starts Delivery Journey
        res_start = await client.post(
            f"/api/driver/assignments/{asg_id}/start",
            json={
                "vehicle_id": vehicle.id,
                "origin_name": "Guindy Central Depot, Chennai",
                "origin_lat": 13.0067,
                "origin_lng": 80.2025,
            },
            headers=drv_headers,
        )
        assert res_start.status_code == 200
        journey_id = res_start.json()["journey_id"]

        # Step 7: Confirm Overview reflects IN_TRANSIT, origin and destination routes
        res_ov4 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov4.status_code == 200
        target_v4 = next(v for v in res_ov4.json() if v["vehicle_id"] == vehicle.id)
        assert target_v4["status"] == "IN_TRANSIT"
        assert target_v4["current_journey_id"] == journey_id
        assert target_v4["origin_name"] == "Guindy Central Depot, Chennai"
        assert target_v4["destination_name"] == dest_address
        assert target_v4["latest_latitude"] == pytest.approx(13.0067, rel=1e-4)
        assert target_v4["latest_longitude"] == pytest.approx(80.2025, rel=1e-4)

        # Step 8: Driver Transmits Live GPS Coordinates
        res_gps = await client.post(
            f"/api/journeys/{journey_id}/location",
            json={
                "latitude": 13.0350,
                "longitude": 80.2250,
                "speed": 42.5,
                "heading": 45.0,
                "accuracy": 4.0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            headers=drv_headers,
        )
        assert res_gps.status_code in (200, 201)

        # Step 9: Confirm Overview reflects updated GPS coordinates and speed
        res_ov5 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov5.status_code == 200
        target_v5 = next(v for v in res_ov5.json() if v["vehicle_id"] == vehicle.id)
        assert target_v5["status"] == "IN_TRANSIT"
        assert target_v5["latest_latitude"] == pytest.approx(13.0350, rel=1e-4)
        assert target_v5["latest_longitude"] == pytest.approx(80.2250, rel=1e-4)
        assert target_v5["latest_speed"] == pytest.approx(42.5, rel=1e-2)

        # Step 10: Complete the Delivery Assignment
        res_comp = await client.post(f"/api/driver/assignments/{asg_id}/complete", headers=drv_headers)
        assert res_comp.status_code == 200

        # Step 11: Confirm Overview restores status to AVAILABLE, clears active route, sets resting speed 0
        res_ov6 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov6.status_code == 200
        target_v6 = next(v for v in res_ov6.json() if v["vehicle_id"] == vehicle.id)
        assert target_v6["status"] == "AVAILABLE"
        assert target_v6["origin_name"] is None
        assert target_v6["destination_name"] is None
        assert target_v6["latest_speed"] == 0.0


@pytest.mark.asyncio
async def test_multiple_vehicles_independent_synchronization(auth_headers_factory):
    """Verify that multiple vehicles within the same company update their dispatch state independently."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="MultiFleet Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Multi Manager",
            email=f"multi_mgr_{uuid.uuid4().hex[:6]}@multi.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        d1 = User(
            company_id=comp.id,
            name="Driver One",
            email=f"d1_{uuid.uuid4().hex[:6]}@multi.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        d2 = User(
            company_id=comp.id,
            name="Driver Two",
            email=f"d2_{uuid.uuid4().hex[:6]}@multi.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        db.add_all([manager, d1, d2])
        await db.flush()

        v1 = Vehicle(
            company_id=comp.id,
            registration_number="VAN-MULTI-01",
            model="Ford Transit",
            status="AVAILABLE",
            assigned_driver_id=d1.id,
        )
        v2 = Vehicle(
            company_id=comp.id,
            registration_number="VAN-MULTI-02",
            model="Mercedes Sprinter",
            status="AVAILABLE",
            assigned_driver_id=d2.id,
        )
        db.add_all([v1, v2])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(d1)
        await db.refresh(d2)
        await db.refresh(v1)
        await db.refresh(v2)

    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Assign only to Driver 1
        res_assign = await client.post(
            "/api/dispatch/assignments",
            json={
                "driver_id": d1.id,
                "destination_name": "Anna Nagar Hub",
                "destination_lat": 13.0850,
                "destination_lng": 80.2100,
            },
            headers=mgr_headers,
        )
        assert res_assign.status_code == 201

        # Check Overview: V1 must be BUSY, V2 must remain AVAILABLE
        res_ov = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_ov.status_code == 200
        vehicles = res_ov.json()
        veh1_data = next(v for v in vehicles if v["vehicle_id"] == v1.id)
        veh2_data = next(v for v in vehicles if v["vehicle_id"] == v2.id)

        assert veh1_data["status"] == "BUSY"
        assert veh1_data["destination_name"] == "Anna Nagar Hub"

        assert veh2_data["status"] == "AVAILABLE"
        assert veh2_data["destination_name"] is None
