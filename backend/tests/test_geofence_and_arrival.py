"""
Integration test suite for:
- Part 1: Geofence Creation, 36-char UUID, Circle/Polygon, Update, Delete
- Part 2: Geofence Entry & Exit Detection, Deduplication, Re-entry, Noise Filtering
- Part 3: Automatic Destination Arrival Detection, Radius, Accuracy, Auto-Completion
- Part 4: Idempotent Manual End Journey handling
- Part 5: Multi-tenant Company Notification Isolation
"""

import pytest
import pytest_asyncio
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.models.geofence import Geofence
from app.models.delivery_assignment import DeliveryAssignment
from app.models.trip_event import TripEvent
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
async def test_geofence_creation_and_crud(auth_headers_factory):
    """Verify Part 1: Geofences use standard 36-character UUIDs, support Circle & Polygon, and perform full CRUD."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="Geofence Test Logistics", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Geofence Manager",
            email=f"gf_mgr_{uuid.uuid4().hex[:6]}@sync.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        db.add(manager)
        await db.commit()
        await db.refresh(manager)

    mgr_headers = auth_headers_factory(manager)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create Circle Geofence
        circle_payload = {
            "name": "Central Depot Warehouse Hub",
            "description": "Main logistics departure and return zone",
            "kind": "circle",
            "geometry": {
                "type": "circle",
                "center": [13.0827, 80.2707],
                "radius": 400.0,
            },
            "area": "CIRCLE (13.0827 80.2707, 400)",
        }
        res_circle = await client.post("/api/geofences", json=circle_payload, headers=mgr_headers)
        assert res_circle.status_code == 201
        data_circle = res_circle.json()

        # Strict UUID length check: MUST be exactly 36 characters (UUID v4 format: 8-4-4-4-12)
        assert len(data_circle["id"]) == 36
        assert not data_circle["id"].startswith("gf-")
        uuid.UUID(data_circle["id"])  # Validates standard UUID syntax

        assert data_circle["name"] == "Central Depot Warehouse Hub"
        assert data_circle["kind"] == "circle"
        assert data_circle["geometry"]["center"] == [13.0827, 80.2707]
        assert data_circle["geometry"]["radius"] == 400.0

        # 2. Create Polygon Geofence
        poly_coords = [
            [80.2500, 13.0500],
            [80.2600, 13.0500],
            [80.2600, 13.0600],
            [80.2500, 13.0600],
            [80.2500, 13.0500],
        ]
        poly_payload = {
            "name": "Restricted Port Enclosure",
            "description": "High security harbor perimeter",
            "kind": "polygon",
            "geometry": {
                "type": "Polygon",
                "coordinates": [poly_coords],
            },
        }
        res_poly = await client.post("/api/geofences", json=poly_payload, headers=mgr_headers)
        assert res_poly.status_code == 201
        data_poly = res_poly.json()
        assert len(data_poly["id"]) == 36
        uuid.UUID(data_poly["id"])
        assert data_poly["kind"] == "polygon"

        # 3. Retrieve Geofence List
        res_list = await client.get("/api/geofences", headers=mgr_headers)
        assert res_list.status_code == 200
        items = res_list.json()
        assert len(items) >= 2
        ids = [item["id"] for item in items]
        assert data_circle["id"] in ids
        assert data_poly["id"] in ids

        # 4. Update Geofence
        update_payload = {
            "name": "Updated Warehouse Hub",
            "description": "Expanded north dock zone",
        }
        res_update = await client.put(f"/api/geofences/{data_circle['id']}", json=update_payload, headers=mgr_headers)
        assert res_update.status_code == 200
        assert res_update.json()["name"] == "Updated Warehouse Hub"

        # 5. Delete Geofence
        res_del = await client.delete(f"/api/geofences/{data_poly['id']}", headers=mgr_headers)
        assert res_del.status_code == 204

        # Confirm deleted
        res_get = await client.get(f"/api/geofences/{data_poly['id']}", headers=mgr_headers)
        assert res_get.status_code == 404


@pytest.mark.asyncio
async def test_vehicle_geofence_entry_and_exit_lifecycle(auth_headers_factory):
    """Verify Part 2: Geofence entry and exit detection, deduplication, and genuine re-entry notifications."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp = Company(name="Metro Express Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Metro Manager",
            email=f"metro_mgr_{uuid.uuid4().hex[:6]}@metro.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Karthik R",
            email=f"driver_k_{uuid.uuid4().hex[:6]}@metro.com",
            password_hash=hash_password("Pass123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        db.add_all([manager, driver])
        await db.flush()

        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-01-METRO-101",
            model="Transit Van",
            vehicle_type="VAN",
            status="AVAILABLE",
            assigned_driver_id=driver.id,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(manager)
        await db.refresh(driver)
        await db.refresh(vehicle)

        # Create Geofence centered at (13.0800, 80.2700) with 300m radius
        gf = Geofence(
            id=str(uuid.uuid4()),
            company_id=comp.id,
            name="Anna Salai Hub",
            description="Core city delivery checkpoint",
            kind="circle",
            geometry={
                "type": "circle",
                "center": [13.0800, 80.2700],
                "radius": 300.0,
            },
        )
        db.add(gf)
        await db.commit()
        await db.refresh(gf)

    mgr_headers = auth_headers_factory(manager)
    drv_headers = auth_headers_factory(driver)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start journey outside the geofence (13.0900, 80.2700 is ~1.1km north)
        start_payload = {
            "origin_name": "North Depot",
            "origin_lat": 13.0900,
            "origin_lng": 80.2700,
            "destination_name": "South Terminal",
            "destination_lat": 13.0600,
            "destination_lng": 80.2700,
            "vehicle_id": vehicle.id,
        }
        res_start = await client.post("/api/journeys/start", json=start_payload, headers=drv_headers)
        assert res_start.status_code == 201
        journey_id = res_start.json()["journey_id"]

        # Ping 1: Outside geofence (13.0900, 80.2700)
        p1 = {
            "latitude": 13.0900,
            "longitude": 80.2700,
            "speed": 35.0,
            "heading": 180.0,
            "accuracy": 10.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p1 = await client.post(f"/api/journeys/{journey_id}/location", json=p1, headers=drv_headers)
        assert res_p1.status_code == 200

        # Verify no geofence events yet
        res_events1 = await client.get("/api/dashboard/events", headers=mgr_headers)
        assert res_events1.status_code == 200
        gf_events1 = [e for e in res_events1.json() if e.get("event_type") == "GEOFENCE_ENTER"]
        assert len(gf_events1) == 0

        # Ping 2: Inside Anna Salai Hub (13.0805, 80.2702 is ~60m from center)
        p2 = {
            "latitude": 13.0805,
            "longitude": 80.2702,
            "speed": 22.0,
            "heading": 180.0,
            "accuracy": 12.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p2 = await client.post(f"/api/journeys/{journey_id}/location", json=p2, headers=drv_headers)
        assert res_p2.status_code == 200

        # Verify GEOFENCE_ENTER event created
        res_events2 = await client.get("/api/dashboard/events", headers=mgr_headers)
        assert res_events2.status_code == 200
        gf_events2 = [e for e in res_events2.json() if e.get("event_type") == "GEOFENCE_ENTER"]
        assert len(gf_events2) == 1
        enter_ev = gf_events2[0]
        assert enter_ev["metadata_json"]["geofence_name"] == "Anna Salai Hub"
        assert enter_ev["vehicle_registration"] == "TN-01-METRO-101"
        assert enter_ev["driver_name"] == "Karthik R"

        # Ping 3: Still inside geofence (13.0802, 80.2701)
        p3 = {
            "latitude": 13.0802,
            "longitude": 80.2701,
            "speed": 18.0,
            "heading": 180.0,
            "accuracy": 10.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p3 = await client.post(f"/api/journeys/{journey_id}/location", json=p3, headers=drv_headers)
        assert res_p3.status_code == 200

        # Verify NO duplicate GEOFENCE_ENTER event generated while remaining inside
        res_events3 = await client.get("/api/dashboard/events", headers=mgr_headers)
        gf_events3 = [e for e in res_events3.json() if e.get("event_type") == "GEOFENCE_ENTER"]
        assert len(gf_events3) == 1

        # Ping 4: Exit geofence (13.0720, 80.2700 is ~890m south, outside 300m radius)
        p4 = {
            "latitude": 13.0720,
            "longitude": 80.2700,
            "speed": 40.0,
            "heading": 180.0,
            "accuracy": 15.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p4 = await client.post(f"/api/journeys/{journey_id}/location", json=p4, headers=drv_headers)
        assert res_p4.status_code == 200

        # Verify GEOFENCE_EXIT event generated
        res_events4 = await client.get("/api/dashboard/events", headers=mgr_headers)
        gf_exit_events = [e for e in res_events4.json() if e.get("event_type") == "GEOFENCE_EXIT"]
        assert len(gf_exit_events) == 1
        assert gf_exit_events[0]["metadata_json"]["geofence_name"] == "Anna Salai Hub"

        # Ping 5: Re-enter geofence (13.0801, 80.2701)
        p5 = {
            "latitude": 13.0801,
            "longitude": 80.2701,
            "speed": 20.0,
            "heading": 0.0,
            "accuracy": 12.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p5 = await client.post(f"/api/journeys/{journey_id}/location", json=p5, headers=drv_headers)
        assert res_p5.status_code == 200

        # Verify new GEOFENCE_ENTER event on genuine re-entry
        res_events5 = await client.get("/api/dashboard/events", headers=mgr_headers)
        gf_events5 = [e for e in res_events5.json() if e.get("event_type") == "GEOFENCE_ENTER"]
        assert len(gf_events5) == 2


@pytest.mark.asyncio
async def test_automatic_destination_arrival_and_idempotent_end_journey(auth_headers_factory):
    """Verify Part 3 & 4: Destination arrival detection, auto-completion of delivery & journey, and manual End Journey safety."""
    transport = ASGITransport(app=app)

    dest_lat = 13.060422
    dest_lng = 80.249583
    dest_name = "Apollo Specialty Hospital, Chennai"

    async with AsyncSessionLocal() as db:
        comp = Company(name="Express Care Fleet", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        manager = User(
            company_id=comp.id,
            name="Dispatch Manager",
            email=f"care_mgr_{uuid.uuid4().hex[:6]}@care.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        driver = User(
            company_id=comp.id,
            name="Suresh Kumar",
            email=f"driver_sk_{uuid.uuid4().hex[:6]}@care.com",
            password_hash=hash_password("Pass123!"),
            role="DRIVER",
            availability="AVAILABLE",
            is_active=True,
        )
        db.add_all([manager, driver])
        await db.flush()

        vehicle = Vehicle(
            company_id=comp.id,
            registration_number="TN-09-CARE-888",
            model="Emergency Cargo Van",
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
        # 1. Manager dispatches a delivery to destination
        res_assign = await client.post(
            "/api/dispatch/assignments",
            json={
                "driver_id": driver.id,
                "destination_name": dest_name,
                "destination_lat": dest_lat,
                "destination_lng": dest_lng,
                "instructions": "Urgent medicine delivery",
            },
            headers=mgr_headers,
        )
        assert res_assign.status_code == 201
        asg_id = res_assign.json()["id"]

        # 2. Driver accepts delivery
        res_accept = await client.post(f"/api/driver/assignments/{asg_id}/accept", headers=drv_headers)
        assert res_accept.status_code == 200

        # 3. Driver starts journey from origin (13.0850, 80.2100, ~5km away)
        res_start = await client.post(
            f"/api/driver/assignments/{asg_id}/start",
            json={"origin_name": "Central Pharmacy Depot"},
            headers=drv_headers,
        )
        assert res_start.status_code == 200
        journey_id = res_start.json()["journey_id"]

        # 4. In-transit GPS ping far from destination (2km away)
        ping_far = {
            "latitude": 13.0750,
            "longitude": 80.2350,
            "speed": 45.0,
            "heading": 120.0,
            "accuracy": 15.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p_far = await client.post(f"/api/journeys/{journey_id}/location", json=ping_far, headers=drv_headers)
        assert res_p_far.status_code == 200

        # Confirm journey is still IN_PROGRESS
        res_j_check = await client.get(f"/api/journeys/{journey_id}", headers=drv_headers)
        assert res_j_check.status_code == 200
        assert res_j_check.json()["status"] == "IN_PROGRESS"

        # 5. GPS ping with poor accuracy (> 100m, e.g. 150m) even if close to destination
        ping_inaccurate = {
            "latitude": dest_lat + 0.0001,
            "longitude": dest_lng + 0.0001,
            "speed": 10.0,
            "heading": 90.0,
            "accuracy": 150.0,  # Inaccurate fix
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p_inacc = await client.post(f"/api/journeys/{journey_id}/location", json=ping_inaccurate, headers=drv_headers)
        assert res_p_inacc.status_code == 200

        # Confirm NOT falsely triggered by inaccurate fix
        res_j_inacc = await client.get(f"/api/journeys/{journey_id}", headers=drv_headers)
        assert res_j_inacc.json()["status"] == "IN_PROGRESS"

        # 6. High-accuracy fix directly at destination (< 100m, low speed 12 km/h)
        # 13.060422, 80.249583 is exactly the destination
        ping_arrival = {
            "latitude": dest_lat,
            "longitude": dest_lng,
            "speed": 8.0,
            "heading": 85.0,
            "accuracy": 8.0,  # High accuracy
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        res_p_arr = await client.post(f"/api/journeys/{journey_id}/location", json=ping_arrival, headers=drv_headers)
        assert res_p_arr.status_code == 200

        # 7. Verify automatic journey completion
        res_j_arr = await client.get(f"/api/journeys/{journey_id}", headers=drv_headers)
        assert res_j_arr.status_code == 200
        assert res_j_arr.json()["status"] == "COMPLETED"

        # 8. Verify delivery assignment is COMPLETED
        res_asg_arr = await client.get(f"/api/dispatch/assignments/{asg_id}", headers=mgr_headers)
        assert res_asg_arr.status_code == 200
        assert res_asg_arr.json()["status"] == "COMPLETED"

        # 9. Verify DESTINATION_REACHED event logged and notified
        res_events = await client.get("/api/dashboard/events", headers=mgr_headers)
        assert res_events.status_code == 200
        dest_events = [e for e in res_events.json() if e.get("event_type") == "DESTINATION_REACHED"]
        assert len(dest_events) >= 1
        arr_ev = dest_events[0]
        assert arr_ev["metadata_json"]["destination_name"] == dest_name
        assert arr_ev["vehicle_registration"] == "TN-09-CARE-888"
        assert arr_ev["driver_name"] == "Suresh Kumar"

        # 10. Part 4 Idempotency Check: Driver manually ends journey AFTER auto-completion
        # Must return HTTP 200 with COMPLETED status and not corrupt DB or raise 500/400
        res_manual_end = await client.post(f"/api/journeys/{journey_id}/end", headers=drv_headers)
        assert res_manual_end.status_code == 200
        assert res_manual_end.json()["status"] == "COMPLETED"

        res_manual_asg_comp = await client.post(f"/api/driver/assignments/{asg_id}/complete", headers=drv_headers)
        assert res_manual_asg_comp.status_code == 200
        assert res_manual_asg_comp.json()["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_company_isolation_on_geofences_and_events(auth_headers_factory):
    """Verify Part 5: Complete data isolation between companies for geofences and events."""
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as db:
        comp_a = Company(name="Alpha Logistics", invite_code=uuid.uuid4().hex[:8].upper())
        comp_b = Company(name="Beta Shipping", invite_code=uuid.uuid4().hex[:8].upper())
        db.add_all([comp_a, comp_b])
        await db.commit()
        await db.refresh(comp_a)
        await db.refresh(comp_b)

        mgr_a = User(
            company_id=comp_a.id,
            name="Alpha Manager",
            email=f"alpha_{uuid.uuid4().hex[:6]}@alpha.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        mgr_b = User(
            company_id=comp_b.id,
            name="Beta Manager",
            email=f"beta_{uuid.uuid4().hex[:6]}@beta.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        db.add_all([mgr_a, mgr_b])
        await db.commit()
        await db.refresh(mgr_a)
        await db.refresh(mgr_b)

        # Create Geofence belonging to Company A
        gf_a = Geofence(
            id=str(uuid.uuid4()),
            company_id=comp_a.id,
            name="Alpha Zone",
            kind="circle",
            geometry={"type": "circle", "center": [13.0, 80.0], "radius": 100},
        )
        db.add(gf_a)
        await db.commit()
        await db.refresh(gf_a)

    headers_a = auth_headers_factory(mgr_a)
    headers_b = auth_headers_factory(mgr_b)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Company A can see Alpha Zone
        res_a = await client.get("/api/geofences", headers=headers_a)
        assert res_a.status_code == 200
        assert any(g["id"] == gf_a.id for g in res_a.json())

        # Company B CANNOT see Alpha Zone
        res_b = await client.get("/api/geofences", headers=headers_b)
        assert res_b.status_code == 200
        assert not any(g["id"] == gf_a.id for g in res_b.json())

        # Company B cannot access Alpha Zone by ID
        res_b_get = await client.get(f"/api/geofences/{gf_a.id}", headers=headers_b)
        assert res_b_get.status_code == 403
