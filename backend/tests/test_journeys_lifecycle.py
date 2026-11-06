import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.api.auth import seed_demo_users
from app.api.vehicles import seed_demo_vehicles


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_demo_users(db)
        await seed_demo_vehicles(db)


@pytest.mark.asyncio
async def test_full_journey_lifecycle_and_link_expiry():
    """
    E2E Journey Lifecycle Test:
    1. Driver logs in & starts trip -> gets tracking token
    2. Public viewer resolves token -> gets live trip info
    3. Driver uploads GPS ping -> public location endpoint reflects it
    4. Cross-driver IDOR prevention -> Driver B cannot end or ping Driver A's trip
    5. Driver concludes trip -> tracking token is revoked
    6. Public viewer accesses tracking link -> receives HTTP 410 GONE
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Driver 1 Login
        login_res = await client.post("/api/auth/login", json={
            "email": "driver1@fleetcorp.com",
            "password": "Password123!"
        })
        assert login_res.status_code == 200
        driver1_token = login_res.json()["access_token"]
        driver1_headers = {"Authorization": f"Bearer {driver1_token}"}

        # 2. Driver 1 Starts Journey
        start_res = await client.post("/api/journeys/start", json={
            "vehicle_id": "custom",
            "vehicle_registration": "E2E-TEST-01",
            "vehicle_model": "Delivery Van",
            "vehicle_type": "VAN",
            "origin_name": "Warehouse Alpha",
            "origin_lat": 12.9716,
            "origin_lng": 77.5946,
            "destination_name": "Retail Hub Beta",
            "destination_lat": 12.9800,
            "destination_lng": 77.6000,
            "description": "Priority Dispatch"
        }, headers=driver1_headers)
        assert start_res.status_code == 201
        trip_data = start_res.json()
        journey_id = trip_data["journey_id"]
        tracking_token = trip_data["tracking_token"]

        assert journey_id is not None
        assert tracking_token is not None

        # 3. Public Viewer Resolves Tracking Link
        viewer_res = await client.get(f"/api/track/{tracking_token}")
        assert viewer_res.status_code == 200
        viewer_data = viewer_res.json()
        assert viewer_data["status"] == "IN_PROGRESS"
        assert viewer_data["vehicle_registration"] == "E2E-TEST-01"
        assert viewer_data["origin_name"] == "Warehouse Alpha"
        assert viewer_data["destination_name"] == "Retail Hub Beta"

        # 4. Driver 1 Sends GPS Location Ping
        now_iso = datetime.now(timezone.utc).isoformat()
        ping_res = await client.post(f"/api/journeys/{journey_id}/location", json={
            "latitude": 12.9750,
            "longitude": 77.5970,
            "speed": 45.0,
            "heading": 85.0,
            "accuracy": 8.0,
            "altitude": 900.0,
            "timestamp": now_iso
        }, headers=driver1_headers)
        assert ping_res.status_code == 200

        # Public viewer polls latest location
        loc_res = await client.get(f"/api/track/{tracking_token}/location")
        assert loc_res.status_code == 200
        loc_data = loc_res.json()
        assert loc_data["is_active"] is True
        assert loc_data["latest_location"]["latitude"] == 12.9750
        assert loc_data["latest_location"]["longitude"] == 77.5970

        # 5. IDOR Prevention: Driver 2 (from Company 2) attempts to tamper with Journey 1
        driver2_login = await client.post("/api/auth/login", json={
            "email": "driver@apex.com",
            "password": "Password123!"
        })
        assert driver2_login.status_code == 200
        driver2_token = driver2_login.json()["access_token"]
        driver2_headers = {"Authorization": f"Bearer {driver2_token}"}

        # Driver 2 tries to send location to Journey 1
        tamper_ping = await client.post(f"/api/journeys/{journey_id}/location", json={
            "latitude": 13.0000,
            "longitude": 77.6000,
            "speed": 10.0,
            "heading": 0.0,
            "accuracy": 5.0,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }, headers=driver2_headers)
        assert tamper_ping.status_code == 403  # Access denied

        # Driver 2 tries to end Journey 1
        tamper_end = await client.post(f"/api/journeys/{journey_id}/end", headers=driver2_headers)
        assert tamper_end.status_code == 403  # Access denied

        # 6. Driver 1 Concludes Journey
        end_res = await client.post(f"/api/journeys/{journey_id}/end", headers=driver1_headers)
        assert end_res.status_code == 200
        end_data = end_res.json()
        assert end_data["status"] == "COMPLETED"

        # 7. Public Viewer Accesses Tracking Link After Conclusion
        expired_res = await client.get(f"/api/track/{tracking_token}")
        assert expired_res.status_code == 410  # HTTP 410 Gone
