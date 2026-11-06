"""
Targeted Verification Suite for Journey Source & Destination Accuracy.
Explicitly executes user test requirements 1 through 7:
TEST 1: Create journey with specific source & destination; verify saved in DB.
TEST 2: Driver Portal query; verify both locations displayed.
TEST 3: Manager Dashboard query; verify identical locations displayed.
TEST 4: Refresh both portals; verify locations remain unchanged.
TEST 5: Send new GPS telemetry; verify only vehicle marker moves while source and destination remain unchanged.
TEST 6: End journey; verify history still displays original source and destination.
TEST 7: Create another journey with different locations; verify no cross-contamination.
"""
import pytest
import pytest_asyncio
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.security.passwords import hash_password
from app.security.jwt import create_access_token


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()


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
async def test_source_and_destination_lifecycle(auth_headers_factory):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed test company, manager, driver, and vehicle
        uid = uuid.uuid4().hex[:6]
        async with AsyncSessionLocal() as session:
            company = Company(
                id=str(uuid.uuid4()),
                name=f"SourceDest Corp {uid}",
                invite_code=f"INV-{uid.upper()}",
            )
            session.add(company)
            await session.flush()

            manager = User(
                id=str(uuid.uuid4()),
                email=f"mgr_{uid}@fleet.com",
                name="Manager Alice",
                password_hash=hash_password("Password123!"),
                role="FLEET_MANAGER",
                company_id=company.id,
            )
            driver = User(
                id=str(uuid.uuid4()),
                email=f"drv_{uid}@fleet.com",
                name="Driver Bob",
                password_hash=hash_password("Password123!"),
                role="DRIVER",
                company_id=company.id,
            )
            vehicle = Vehicle(
                id=str(uuid.uuid4()),
                company_id=company.id,
                registration_number=f"TRIP-{uid.upper()}",
                model="Volvo Electric Truck",
                vehicle_type="TRUCK",
                battery_or_fuel_level=90.0,
                status="AVAILABLE",
            )
            session.add_all([manager, driver, vehicle])
            await session.commit()
            await session.refresh(company)
            await session.refresh(manager)
            await session.refresh(driver)
            await session.refresh(vehicle)

        mgr_headers = auth_headers_factory(manager)
        drv_headers = auth_headers_factory(driver)

        # =====================================================================
        # TEST 1: Create a journey with specific source and destination.
        # Verify both values are saved correctly.
        # =====================================================================
        source_name_1 = "Mumbai Central Logistics Hub"
        source_lat_1 = 18.9696
        source_lng_1 = 72.8193

        dest_name_1 = "Pune Technology Park"
        dest_lat_1 = 18.5204
        dest_lng_1 = 73.8567

        payload_1 = {
            "vehicle_id": vehicle.id,
            "origin_name": source_name_1,
            "origin_lat": source_lat_1,
            "origin_lng": source_lng_1,
            "destination_name": dest_name_1,
            "destination_lat": dest_lat_1,
            "destination_lng": dest_lng_1,
            "description": "Consignment #101 Test",
        }

        resp_create = await client.post("/api/journeys/start", json=payload_1, headers=drv_headers)
        assert resp_create.status_code == 201, f"Failed start: {resp_create.text}"
        data_create = resp_create.json()
        journey_id_1 = data_create["journey_id"]

        # Verify returned start response contains verified source & destination
        assert data_create["origin_name"] == source_name_1
        assert abs(data_create["origin_lat"] - source_lat_1) < 0.0001
        assert abs(data_create["origin_lng"] - source_lng_1) < 0.0001
        assert data_create["destination_name"] == dest_name_1
        assert abs(data_create["destination_lat"] - dest_lat_1) < 0.0001
        assert abs(data_create["destination_lng"] - dest_lng_1) < 0.0001
        assert data_create["vehicle_registration"] == vehicle.registration_number

        # Direct Database verification
        async with AsyncSessionLocal() as session:
            stmt = select(Journey).where(Journey.id == journey_id_1)
            res = await session.execute(stmt)
            db_journey = res.scalar_one_or_none()
            assert db_journey is not None
            assert db_journey.origin_name == source_name_1
            assert db_journey.destination_name == dest_name_1
            assert abs(db_journey.origin_lat - source_lat_1) < 0.0001
            assert abs(db_journey.destination_lat - dest_lat_1) < 0.0001

        # =====================================================================
        # TEST 2: Log in as the driver. Verify both locations are displayed.
        # =====================================================================
        resp_drv_active = await client.get("/api/journeys/active", headers=drv_headers)
        assert resp_drv_active.status_code == 200
        drv_active_list = resp_drv_active.json()
        assert len(drv_active_list) >= 1
        drv_j = next((j for j in drv_active_list if j["id"] == journey_id_1), None)
        assert drv_j is not None
        assert drv_j["origin_name"] == source_name_1
        assert drv_j["destination_name"] == dest_name_1
        assert drv_j["vehicle_registration"] == vehicle.registration_number
        assert drv_j["status"] == "IN_PROGRESS"

        # =====================================================================
        # TEST 3: Log in as the manager. Verify the same two locations are displayed.
        # =====================================================================
        resp_mgr_journeys = await client.get("/api/dashboard/active-journeys", headers=mgr_headers)
        assert resp_mgr_journeys.status_code == 200
        mgr_j_list = resp_mgr_journeys.json()
        mgr_j = next((j for j in mgr_j_list if j["journey_id"] == journey_id_1), None)
        assert mgr_j is not None
        assert mgr_j["origin_name"] == source_name_1
        assert mgr_j["destination_name"] == dest_name_1
        assert mgr_j["vehicle_registration"] == vehicle.registration_number
        assert mgr_j["driver_name"] == driver.name
        assert mgr_j["status"] == "IN_PROGRESS"

        # Also verify ActiveVehicleResponse carries source and destination
        resp_mgr_vehicles = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert resp_mgr_vehicles.status_code == 200
        mgr_v = next((v for v in resp_mgr_vehicles.json() if v["vehicle_id"] == vehicle.id), None)
        assert mgr_v is not None
        assert mgr_v["origin_name"] == source_name_1
        assert mgr_v["destination_name"] == dest_name_1
        assert mgr_v["status"] == "IN_TRANSIT"

        # =====================================================================
        # TEST 4: Refresh both portals. Verify the locations remain unchanged.
        # =====================================================================
        # Simulating driver portal refresh:
        resp_drv_refresh = await client.get(f"/api/journeys/{journey_id_1}", headers=drv_headers)
        assert resp_drv_refresh.status_code == 200
        refreshed_drv_j = resp_drv_refresh.json()
        assert refreshed_drv_j["origin_name"] == source_name_1
        assert refreshed_drv_j["destination_name"] == dest_name_1

        # Simulating manager portal refresh:
        resp_mgr_refresh = await client.get("/api/dashboard/active-journeys", headers=mgr_headers)
        assert resp_mgr_refresh.status_code == 200
        refreshed_mgr_j = next((j for j in resp_mgr_refresh.json() if j["journey_id"] == journey_id_1), None)
        assert refreshed_mgr_j is not None
        assert refreshed_mgr_j["origin_name"] == source_name_1
        assert refreshed_mgr_j["destination_name"] == dest_name_1

        # =====================================================================
        # TEST 5: Send new GPS coordinates.
        # Verify that only the current vehicle marker moves.
        # The source and destination must remain unchanged.
        # =====================================================================
        midpoint_lat = 18.7500
        midpoint_lng = 73.3000
        gps_ping_payload = {
            "latitude": midpoint_lat,
            "longitude": midpoint_lng,
            "speed": 62.5,
            "heading": 115.0,
            "accuracy": 4.0,
            "altitude": 550.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        resp_ping = await client.post(
            f"/api/journeys/{journey_id_1}/location",
            json=gps_ping_payload,
            headers=drv_headers,
        )
        assert resp_ping.status_code == 200

        # Verify manager active vehicle now has updated moving vehicle position
        resp_v_check = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        updated_v = next((v for v in resp_v_check.json() if v["vehicle_id"] == vehicle.id), None)
        assert updated_v is not None
        assert abs(updated_v["latest_latitude"] - midpoint_lat) < 0.0001
        assert abs(updated_v["latest_longitude"] - midpoint_lng) < 0.0001
        assert updated_v["latest_speed"] == 62.5
        # Source and destination MUST REMAIN UNCHANGED
        assert updated_v["origin_name"] == source_name_1
        assert abs(updated_v["origin_lat"] - source_lat_1) < 0.0001
        assert abs(updated_v["origin_lng"] - source_lng_1) < 0.0001
        assert updated_v["destination_name"] == dest_name_1
        assert abs(updated_v["destination_lat"] - dest_lat_1) < 0.0001
        assert abs(updated_v["destination_lng"] - dest_lng_1) < 0.0001

        # =====================================================================
        # TEST 6: End the journey.
        # Verify that the journey history still displays original source and destination.
        # =====================================================================
        resp_end = await client.post(f"/api/journeys/{journey_id_1}/end", headers=drv_headers)
        assert resp_end.status_code == 200
        assert resp_end.json()["status"] == "COMPLETED"

        resp_history = await client.get("/api/journeys/history", headers=drv_headers)
        assert resp_history.status_code == 200
        history_j = next((j for j in resp_history.json() if j["id"] == journey_id_1), None)
        assert history_j is not None
        assert history_j["status"] == "COMPLETED"
        assert history_j["origin_name"] == source_name_1
        assert history_j["destination_name"] == dest_name_1
        assert abs(history_j["origin_lat"] - source_lat_1) < 0.0001
        assert abs(history_j["destination_lat"] - dest_lat_1) < 0.0001

        # =====================================================================
        # TEST 7: Create another journey with different locations.
        # Verify that previous journey's locations are not accidentally displayed.
        # =====================================================================
        source_name_2 = "Delhi Cargo Terminal"
        source_lat_2 = 28.6139
        source_lng_2 = 77.2090

        dest_name_2 = "Jaipur Industrial Zone"
        dest_lat_2 = 26.9124
        dest_lng_2 = 75.7873

        payload_2 = {
            "vehicle_id": vehicle.id,
            "origin_name": source_name_2,
            "origin_lat": source_lat_2,
            "origin_lng": source_lng_2,
            "destination_name": dest_name_2,
            "destination_lat": dest_lat_2,
            "destination_lng": dest_lng_2,
            "description": "Consignment #202 Test",
        }

        resp_create_2 = await client.post("/api/journeys/start", json=payload_2, headers=drv_headers)
        assert resp_create_2.status_code == 201
        journey_id_2 = resp_create_2.json()["journey_id"]

        # Verify new journey reflects only the new locations
        resp_drv_active_2 = await client.get("/api/journeys/active", headers=drv_headers)
        active_2 = next((j for j in resp_drv_active_2.json() if j["id"] == journey_id_2), None)
        assert active_2 is not None
        assert active_2["origin_name"] == source_name_2
        assert active_2["destination_name"] == dest_name_2
        # Must not show old locations
        assert active_2["origin_name"] != source_name_1
        assert active_2["destination_name"] != dest_name_1

        # Clean up second journey
        await client.post(f"/api/journeys/{journey_id_2}/end", headers=drv_headers)
