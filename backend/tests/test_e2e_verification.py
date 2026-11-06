"""
Comprehensive End-to-End Verification Suite for FleetTrack AI.
Tests 1 through 7 covering:
1. Vehicle creation and persistence verification.
2. Journey creation and vehicle association verification.
3. Live manager tracking with GPS coordinates; verify marker moves & no fake Bangalore coords.
4. Remote public tracking via token without auth; verify live coordinates update.
5. Journey termination & immediate 410 Gone link revocation.
6. Multiple vehicles tracking simultaneously without cross-contamination.
7. Input accuracy across all forms without overwriting defaults.
"""
import pytest
import pytest_asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport

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
async def test_all_seven_scenarios(auth_headers_factory):
    async with AsyncSessionLocal() as db:
        # Create unique company
        comp = Company(
            name=f"E2E Logistics {uuid.uuid4().hex[:6]}",
            invite_code=uuid.uuid4().hex[:8].upper(),
        )
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        # Create manager
        mgr = User(
            company_id=comp.id,
            name="Fleet Director",
            email=f"mgr_{uuid.uuid4().hex[:6]}@e2e.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        # Create driver 1
        drv1 = User(
            company_id=comp.id,
            name="Driver Alpha",
            email=f"drv1_{uuid.uuid4().hex[:6]}@e2e.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            is_active=True,
        )
        # Create driver 2
        drv2 = User(
            company_id=comp.id,
            name="Driver Beta",
            email=f"drv2_{uuid.uuid4().hex[:6]}@e2e.com",
            password_hash=hash_password("Password123!"),
            role="DRIVER",
            is_active=True,
        )
        db.add_all([mgr, drv1, drv2])
        await db.commit()
        await db.refresh(mgr)
        await db.refresh(drv1)
        await db.refresh(drv2)

    mgr_headers = auth_headers_factory(mgr)
    drv1_headers = auth_headers_factory(drv1)
    drv2_headers = auth_headers_factory(drv2)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:

        # =====================================================================
        # TEST 1: Vehicle Creation & Persistence Verification
        # =====================================================================
        veh1_payload = {
            "registration_number": f"MH-12-AB-{uuid.uuid4().hex[:4].upper()}",
            "model": "Volvo Electric Van",
            "vehicle_type": "VAN",
            "status": "AVAILABLE",
            "battery_or_fuel_level": 88.5,
        }
        res_v1 = await client.post("/api/vehicles", json=veh1_payload, headers=mgr_headers)
        assert res_v1.status_code == 201, f"Failed vehicle creation: {res_v1.text}"
        v1_data = res_v1.json()
        veh1_id = v1_data["id"]
        assert v1_data["registration_number"] == veh1_payload["registration_number"]
        assert v1_data["model"] == "Volvo Electric Van"
        assert v1_data["battery_or_fuel_level"] == 88.5

        # Verify persistence on vehicle list
        res_vlist = await client.get("/api/vehicles", headers=mgr_headers)
        assert res_vlist.status_code == 200
        items = res_vlist.json()["items"]
        matching_v = next((v for v in items if v["id"] == veh1_id), None)
        assert matching_v is not None
        assert matching_v["registration_number"] == veh1_payload["registration_number"]

        # Verify vehicle appears on manager dashboard with NO fake Bangalore coords
        res_dash_v = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_dash_v.status_code == 200
        dash_vehicles = res_dash_v.json()
        dash_v1 = next((v for v in dash_vehicles if v["vehicle_id"] == veh1_id), None)
        assert dash_v1 is not None
        # Since brand new vehicle has no pings, coordinates MUST be None (NOT 12.9716 Bangalore!)
        assert dash_v1["latest_latitude"] is None
        assert dash_v1["latest_longitude"] is None

        # =====================================================================
        # TEST 2: Journey Creation & Vehicle Association Verification
        # =====================================================================
        origin_lat = 19.0760
        origin_lng = 72.8777
        dest_lat = 18.5204
        dest_lng = 73.8567

        j1_payload = {
            "vehicle_id": veh1_id,
            "origin_name": "Mumbai Port Warehouse",
            "origin_lat": origin_lat,
            "origin_lng": origin_lng,
            "destination_name": "Pune Tech Hub",
            "destination_lat": dest_lat,
            "destination_lng": dest_lng,
            "description": "Critical Express Delivery",
        }
        res_j1 = await client.post("/api/journeys/start", json=j1_payload, headers=drv1_headers)
        assert res_j1.status_code == 201, f"Failed journey start: {res_j1.text}"
        j1_data = res_j1.json()
        j1_id = j1_data["journey_id"]
        token1 = j1_data["tracking_token"]
        assert j1_data["vehicle_id"] == veh1_id
        assert j1_data["driver_id"] == drv1.id
        assert j1_data["vehicle_registration"] == veh1_payload["registration_number"]
        assert j1_data["tracking_url"].startswith("/track/")  # Relative path!

        # Verify active journeys endpoint for manager
        res_active_j = await client.get("/api/dashboard/active-journeys", headers=mgr_headers)
        assert res_active_j.status_code == 200
        active_list = res_active_j.json()
        found_j1 = next((j for j in active_list if j["journey_id"] == j1_id), None)
        assert found_j1 is not None
        assert found_j1["vehicle_id"] == veh1_id
        assert found_j1["origin_name"] == "Mumbai Port Warehouse"
        assert found_j1["destination_name"] == "Pune Tech Hub"

        # =====================================================================
        # TEST 3: Live Manager Tracking with GPS Updates & Marker Movement
        # =====================================================================
        # Send initial GPS ping from driver
        ping1 = {
            "latitude": 19.0800,
            "longitude": 72.8800,
            "speed": 45.0,
            "heading": 90.0,
            "accuracy": 4.0,
            "altitude": 15.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_ping1 = await client.post(f"/api/journeys/{j1_id}/location", json=ping1, headers=drv1_headers)
        assert res_ping1.status_code == 200

        # Query manager dashboard to verify vehicle location updated
        res_dash_update1 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        assert res_dash_update1.status_code == 200
        v_updated1 = next((v for v in res_dash_update1.json() if v["vehicle_id"] == veh1_id), None)
        assert v_updated1 is not None
        assert v_updated1["latest_latitude"] == 19.0800
        assert v_updated1["latest_longitude"] == 72.8800
        assert v_updated1["latest_speed"] == 45.0

        # Send second GPS ping after rate limit window (0.85s)
        import asyncio
        await asyncio.sleep(0.85)
        ping2 = {
            "latitude": 19.0950,
            "longitude": 72.8950,
            "speed": 62.0,
            "heading": 110.0,
            "accuracy": 3.0,
            "altitude": 18.0,
            "timestamp": (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
        }
        res_ping2 = await client.post(f"/api/journeys/{j1_id}/location", json=ping2, headers=drv1_headers)
        assert res_ping2.status_code == 200
        assert res_ping2.json()["status"] == "recorded"

        # Verify manager dashboard reflects new coordinates
        res_dash_update2 = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        v_updated2 = next((v for v in res_dash_update2.json() if v["vehicle_id"] == veh1_id), None)
        assert v_updated2["latest_latitude"] == 19.0950
        assert v_updated2["latest_longitude"] == 72.8950
        assert v_updated2["latest_speed"] == 62.0

        # =====================================================================
        # TEST 4: Remote Public Tracking Link via Token (No Authentication)
        # =====================================================================
        # Unauthenticated request to public tracking endpoint
        res_public = await client.get(f"/api/track/{token1}")
        assert res_public.status_code == 200, f"Public tracking failed: {res_public.text}"
        public_data = res_public.json()
        assert public_data["journey_id"] == j1_id
        assert public_data["vehicle_registration"] == veh1_payload["registration_number"]
        assert public_data["driver_name"] == drv1.name
        assert public_data["latest_location"]["latitude"] == 19.0950
        assert public_data["latest_location"]["longitude"] == 72.8950
        assert public_data["latest_location"]["speed"] == 62.0

        # Verify public trail endpoint
        res_trail = await client.get(f"/api/track/{token1}/trail")
        assert res_trail.status_code == 200
        trail = res_trail.json()
        assert len(trail) >= 2  # Origin + pings

        # =====================================================================
        # TEST 5: Journey Termination & Immediate 410 Gone Link Revocation
        # =====================================================================
        res_end = await client.post(f"/api/journeys/{j1_id}/end", headers=drv1_headers)
        assert res_end.status_code == 200
        assert res_end.json()["status"] == "COMPLETED"

        # Public tracking token MUST return 410 Gone immediately
        res_revoked = await client.get(f"/api/track/{token1}")
        assert res_revoked.status_code == 410
        assert "THIS JOURNEY HAS ENDED" in res_revoked.json()["detail"]

        # Location trail MUST ALSO return 410 Gone
        res_revoked_trail = await client.get(f"/api/track/{token1}/trail")
        assert res_revoked_trail.status_code == 410

        # Ingesting GPS on completed journey MUST return 410 Gone
        res_expired_ping = await client.post(f"/api/journeys/{j1_id}/location", json=ping2, headers=drv1_headers)
        assert res_expired_ping.status_code == 410

        # =====================================================================
        # TEST 6: Multiple Vehicles Tracking Simultaneously Without Contamination
        # =====================================================================
        # Create Vehicle 2
        veh2_payload = {
            "registration_number": f"DL-01-CD-{uuid.uuid4().hex[:4].upper()}",
            "model": "Tata Heavy Truck",
            "vehicle_type": "TRUCK",
            "status": "AVAILABLE",
            "battery_or_fuel_level": 95.0,
        }
        res_v2 = await client.post("/api/vehicles", json=veh2_payload, headers=mgr_headers)
        assert res_v2.status_code == 201
        veh2_id = res_v2.json()["id"]

        # Start Journey 2 for Driver 2 in Delhi
        j2_payload = {
            "vehicle_id": veh2_id,
            "origin_name": "Delhi Depot",
            "origin_lat": 28.6139,
            "origin_lng": 77.2090,
            "destination_name": "Chandigarh Terminal",
            "destination_lat": 30.7333,
            "destination_lng": 76.7794,
            "description": "North Corridor Cargo",
        }
        res_j2 = await client.post("/api/journeys/start", json=j2_payload, headers=drv2_headers)
        assert res_j2.status_code == 201
        j2_id = res_j2.json()["journey_id"]
        token2 = res_j2.json()["tracking_token"]

        # Send distinct location ping for Vehicle 2 in Delhi
        ping_v2 = {
            "latitude": 28.6300,
            "longitude": 77.2200,
            "speed": 50.0,
            "heading": 350.0,
            "accuracy": 5.0,
            "altitude": 215.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_ping_v2 = await client.post(f"/api/journeys/{j2_id}/location", json=ping_v2, headers=drv2_headers)
        assert res_ping_v2.status_code == 200

        # Verify Manager Dashboard has Vehicle 1 (at Mumbai last known location) and Vehicle 2 (at Delhi)
        res_dash_both = await client.get("/api/dashboard/active-vehicles", headers=mgr_headers)
        all_dash = res_dash_both.json()
        v1_final = next((v for v in all_dash if v["vehicle_id"] == veh1_id), None)
        v2_final = next((v for v in all_dash if v["vehicle_id"] == veh2_id), None)

        assert v1_final is not None
        assert v2_final is not None
        # Vehicle 1 should maintain Mumbai coordinates
        assert abs(v1_final["latest_latitude"] - 19.0950) < 0.001
        assert abs(v1_final["latest_longitude"] - 72.8950) < 0.001
        # Vehicle 2 should maintain Delhi coordinates
        assert abs(v2_final["latest_latitude"] - 28.6300) < 0.001
        assert abs(v2_final["latest_longitude"] - 77.2200) < 0.001

        # Public tracking token 2 should only see Delhi coordinates
        res_pub2 = await client.get(f"/api/track/{token2}")
        assert res_pub2.status_code == 200
        assert abs(res_pub2.json()["latest_location"]["latitude"] - 28.6300) < 0.001

        # =====================================================================
        # TEST 7: Input Accuracy Across All Forms Without Overwriting Defaults
        # =====================================================================
        # Test creating custom vehicle on the fly during journey setup with custom coordinates
        custom_plate = f"TN-07-EF-{uuid.uuid4().hex[:4].upper()}"
        custom_j_payload = {
            "vehicle_registration": custom_plate,
            "vehicle_model": "Custom Courier Scooter",
            "vehicle_type": "MOTORCYCLE",
            "origin_name": "Chennai Harbor",
            "origin_lat": 13.0827,
            "origin_lng": 80.2707,
            "destination_name": "Tambaram Station",
            "destination_lat": 12.9249,
            "destination_lng": 80.1000,
            "description": "Express Medical Sample Delivery",
        }
        res_custom_j = await client.post("/api/journeys/start", json=custom_j_payload, headers=drv1_headers)
        assert res_custom_j.status_code == 201
        custom_data = res_custom_j.json()
        assert custom_data["vehicle_registration"] == custom_plate

        # Verify created vehicle in DB has exact inputs
        res_v_check = await client.get("/api/vehicles", headers=mgr_headers)
        custom_v_db = next((v for v in res_v_check.json()["items"] if v["registration_number"] == custom_plate), None)
        assert custom_v_db is not None
        assert custom_v_db["model"] == "Custom Courier Scooter"
        assert custom_v_db["vehicle_type"] == "MOTORCYCLE"

        # Verify journey in DB has exact coordinates
        res_j_check = await client.get(f"/api/journeys/{custom_data['journey_id']}", headers=drv1_headers)
        assert res_j_check.status_code == 200
        j_db = res_j_check.json()
        assert j_db["origin_name"] == "Chennai Harbor"
        assert abs(j_db["origin_lat"] - 13.0827) < 0.0001
        assert abs(j_db["origin_lng"] - 80.2707) < 0.0001
        assert j_db["destination_name"] == "Tambaram Station"
        assert abs(j_db["destination_lat"] - 12.9249) < 0.0001
        assert abs(j_db["destination_lng"] - 80.1000) < 0.0001
        assert j_db["description"] == "Express Medical Sample Delivery"
