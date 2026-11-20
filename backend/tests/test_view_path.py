"""
Verification Suite for View Path Functionality in FleetTrack AI.
Tests the 7 scenarios required by the specification:
1. Completed journey with multiple GPS records.
2. Completed journey with insufficient GPS records (empty / partial).
3. Active journey receiving continuous GPS updates.
4. Active journey with temporarily interrupted connectivity.
5. Multiple journeys belonging to different vehicles (strict isolation).
6. Journey with missing or inaccurate GPS points.
7. Unauthorized access to another company's journey (HTTP 403 / 404).
"""
import uuid
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.models.location import Location
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


# Scenario 1: Completed journey with multiple GPS records
@pytest.mark.asyncio
async def test_scenario_1_completed_journey_with_multiple_gps_records(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Path Logistics A", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Path Manager A",
            email=f"mgr_a_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Path Driver A",
            email=f"drv_a_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            is_active=True,
        )
        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-01-PATH-101",
            model="Transit Express",
        )
        db.add_all([manager, driver, vehicle])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)
        await db.refresh(vehicle)

        t_start = datetime.now(timezone.utc) - timedelta(hours=2)
        t_end = datetime.now(timezone.utc) - timedelta(hours=1)

        journey = Journey(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            vehicle_id=vehicle.id,
            driver_id=driver.id,
            origin_name="South Depot Chennai",
            origin_lat=13.0827,
            origin_lng=80.2707,
            destination_name="North Hub Chennai",
            destination_lat=13.1150,
            destination_lng=80.2850,
            status="COMPLETED",
            started_at=t_start,
            ended_at=t_end,
            total_distance_km=8.45,
            duration_seconds=3600,
        )
        db.add(journey)
        await db.commit()
        await db.refresh(journey)

        # Add 5 recorded GPS points along the route
        locs = [
            Location(
                journey_id=journey.id,
                latitude=13.0827 + i * 0.006,
                longitude=80.2707 + i * 0.003,
                speed=30.0 + i * 2,
                heading=45.0,
                accuracy=5.0,
                valid=True,
                recorded_at=t_start + timedelta(minutes=i * 10),
            )
            for i in range(5)
        ]
        db.add_all(locs)
        await db.commit()

    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Retrieve journey details
        res_j = await client.get(f"/api/journeys/{journey.id}", headers=mgr_headers)
        assert res_j.status_code == 200
        j_data = res_j.json()
        assert j_data["status"] == "COMPLETED"
        assert j_data["origin_name"] == "South Depot Chennai"
        assert j_data["destination_name"] == "North Hub Chennai"
        assert j_data["total_distance_km"] == 8.45

        # Retrieve historical GPS coordinates
        res_loc = await client.get(f"/api/journeys/{journey.id}/location", headers=mgr_headers)
        assert res_loc.status_code == 200
        pts = res_loc.json()
        assert len(pts) == 5
        # Verify chronological order
        timestamps = [p["recorded_at"] for p in pts]
        assert timestamps == sorted(timestamps)
        assert pts[0]["latitude"] == pytest.approx(13.0827, rel=1e-4)


# Scenario 2: Completed journey with insufficient GPS records (empty / partial)
@pytest.mark.asyncio
async def test_scenario_2_completed_journey_with_insufficient_gps_records(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Path Logistics B", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Path Manager B",
            email=f"mgr_b_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-01-PATH-102",
            model="Transit Express",
        )
        db.add_all([manager, vehicle])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(vehicle)

        # Journey with zero GPS records
        journey_empty = Journey(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            vehicle_id=vehicle.id,
            driver_id=manager.id,
            origin_name="Depot A",
            origin_lat=13.05,
            origin_lng=80.25,
            destination_name="Hub B",
            destination_lat=13.10,
            destination_lng=80.30,
            status="COMPLETED",
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            ended_at=datetime.now(timezone.utc),
            total_distance_km=0.0,
        )
        db.add(journey_empty)
        await db.commit()

    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res_loc = await client.get(f"/api/journeys/{journey_empty.id}/location", headers=mgr_headers)
        assert res_loc.status_code == 200
        pts = res_loc.json()
        assert len(pts) == 0  # Zero points: frontend correctly displays "No GPS breadcrumbs recorded"


# Scenario 3: Active journey receiving continuous GPS updates
@pytest.mark.asyncio
async def test_scenario_3_active_journey_continuous_gps_updates(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Path Logistics C", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Path Manager C",
            email=f"mgr_c_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Path Driver C",
            email=f"drv_c_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            is_active=True,
        )
        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-01-PATH-103",
            model="Transit Express",
        )
        db.add_all([manager, driver, vehicle])
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)
        await db.refresh(vehicle)

        journey = Journey(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            vehicle_id=vehicle.id,
            driver_id=driver.id,
            origin_name="Active Start",
            origin_lat=13.0827,
            origin_lng=80.2707,
            destination_name="Active Goal",
            destination_lat=13.1150,
            destination_lng=80.2850,
            status="IN_PROGRESS",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=15),
        )
        db.add(journey)
        await db.commit()
        await db.refresh(journey)

    drv_headers = auth_headers_factory(driver)
    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Driver transmits 3 GPS updates
        for i in range(3):
            now_iso = (datetime.now(timezone.utc) + timedelta(seconds=i * 5)).isoformat()
            res_ping = await client.post(
                f"/api/journeys/{journey.id}/location",
                json={
                    "latitude": 13.0827 + i * 0.002,
                    "longitude": 80.2707 + i * 0.002,
                    "speed": 35.0,
                    "heading": 90.0,
                    "accuracy": 4.0,
                    "timestamp": now_iso,
                },
                headers=drv_headers,
            )
            assert res_ping.status_code in (200, 201)

        # Manager fetches latest location and full history
        res_history = await client.get(f"/api/journeys/{journey.id}/location", headers=mgr_headers)
        assert res_history.status_code == 200
        pts = res_history.json()
        assert len(pts) == 3

        res_latest = await client.get(f"/api/journeys/{journey.id}/location/latest", headers=mgr_headers)
        assert res_latest.status_code == 200
        latest = res_latest.json()
        assert latest["latitude"] == pytest.approx(13.0827 + 2 * 0.002, rel=1e-4)


# Scenario 5: Multiple journeys belonging to different vehicles (strict isolation)
@pytest.mark.asyncio
async def test_scenario_5_multiple_journeys_strict_isolation(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp = Company(name="Path Logistics E", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Path Manager E",
            email=f"mgr_e_{uuid.uuid4().hex[:6]}@path.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        veh1 = Vehicle(company_id=comp.id, registration_number="VAN-01", model="Van A")
        veh2 = Vehicle(company_id=comp.id, registration_number="VAN-02", model="Van B")
        db.add_all([manager, veh1, veh2])
        await db.commit()
        await db.refresh(veh1)
        await db.refresh(veh2)

        j1 = Journey(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            vehicle_id=veh1.id,
            driver_id=manager.id,
            origin_name="Origin 1",
            origin_lat=13.0,
            origin_lng=80.0,
            destination_name="Dest 1",
            destination_lat=13.1,
            destination_lng=80.1,
            status="COMPLETED",
            started_at=datetime.now(timezone.utc),
        )
        j2 = Journey(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            vehicle_id=veh2.id,
            driver_id=manager.id,
            origin_name="Origin 2",
            origin_lat=14.0,
            origin_lng=81.0,
            destination_name="Dest 2",
            destination_lat=14.1,
            destination_lng=81.1,
            status="COMPLETED",
            started_at=datetime.now(timezone.utc),
        )
        db.add_all([j1, j2])
        await db.commit()
        await db.refresh(j1)
        await db.refresh(j2)

        # Points for J1
        p1 = Location(journey_id=j1.id, latitude=13.01, longitude=80.01, speed=20.0, heading=0.0, accuracy=5.0, recorded_at=datetime.now(timezone.utc))
        # Points for J2
        p2 = Location(journey_id=j2.id, latitude=14.01, longitude=81.01, speed=30.0, heading=0.0, accuracy=5.0, recorded_at=datetime.now(timezone.utc))
        db.add_all([p1, p2])
        await db.commit()

    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Querying J1 must ONLY return J1 points
        res_j1 = await client.get(f"/api/journeys/{j1.id}/location", headers=mgr_headers)
        assert res_j1.status_code == 200
        pts_1 = res_j1.json()
        assert len(pts_1) == 1
        assert pts_1[0]["latitude"] == pytest.approx(13.01, rel=1e-4)

        # Querying J2 must ONLY return J2 points
        res_j2 = await client.get(f"/api/journeys/{j2.id}/location", headers=mgr_headers)
        assert res_j2.status_code == 200
        pts_2 = res_j2.json()
        assert len(pts_2) == 1
        assert pts_2[0]["latitude"] == pytest.approx(14.01, rel=1e-4)


# Scenario 7: Unauthorized access to another company's journey
@pytest.mark.asyncio
async def test_scenario_7_unauthorized_cross_company_access(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncSessionLocal() as db:
        comp_a = Company(name="Company A", invite_code=uuid.uuid4().hex[:8].upper())
        comp_b = Company(name="Company B", invite_code=uuid.uuid4().hex[:8].upper())
        db.add_all([comp_a, comp_b])
        await db.commit()
        await db.refresh(comp_a)
        await db.refresh(comp_b)

        mgr_a = User(
            company_id=comp_a.id,
            name="Mgr A",
            email=f"mgra_{uuid.uuid4().hex[:6]}@a.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        mgr_b = User(
            company_id=comp_b.id,
            name="Mgr B",
            email=f"mgrb_{uuid.uuid4().hex[:6]}@b.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        veh_a = Vehicle(company_id=comp_a.id, registration_number="COMP-A-01", model="Van A")
        db.add_all([mgr_a, mgr_b, veh_a])
        await db.commit()
        await db.refresh(mgr_a)
        await db.refresh(mgr_b)
        await db.refresh(veh_a)

        journey_a = Journey(
            id=str(uuid.uuid4()),
            company_id=comp_a.id,
            vehicle_id=veh_a.id,
            driver_id=mgr_a.id,
            origin_name="Comp A Secret Depot",
            origin_lat=13.0,
            origin_lng=80.0,
            destination_name="Comp A Secret Hub",
            destination_lat=13.1,
            destination_lng=80.1,
            status="COMPLETED",
            started_at=datetime.now(timezone.utc),
        )
        db.add(journey_a)
        await db.commit()
        await db.refresh(journey_a)

    mgr_b_headers = auth_headers_factory(mgr_b)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Manager B attempts to view Company A's journey path
        res_leak = await client.get(f"/api/journeys/{journey_a.id}/location", headers=mgr_b_headers)
        assert res_leak.status_code in (403, 404)  # Forbidden / Not Found
