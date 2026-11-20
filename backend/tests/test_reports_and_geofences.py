"""Tests for Phase 6: Read APIs & Reports (Geofences CRUD, Positions, Route/Trips/Stops/Summary Reports)."""

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
from app.models.location import Location
from app.security.passwords import hash_password


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()


@pytest.mark.asyncio
async def test_geofences_crud_and_reports(auth_headers_factory):
    async with AsyncSessionLocal() as db:
        comp = Company(name="Reports Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        mgr = User(
            company_id=comp.id,
            name="Reports Manager",
            email=f"rep_mgr_{uuid.uuid4().hex[:6]}@r.com",
            password_hash=hash_password("Pass123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        veh = Vehicle(company_id=comp.id, registration_number=f"REP-{uuid.uuid4().hex[:4]}", model="Van", vehicle_type="VAN")
        db.add_all([mgr, veh])
        await db.commit()
        await db.refresh(mgr)
        await db.refresh(veh)

        journey = Journey(
            company_id=comp.id,
            vehicle_id=veh.id,
            driver_id=mgr.id,
            origin_name="Depot A",
            origin_lat=12.9716,
            origin_lng=77.5946,
            destination_name="Warehouse B",
            destination_lat=12.9760,
            destination_lng=77.5990,
            status="IN_PROGRESS",
            total_distance_km=1.1,
        )
        db.add(journey)
        await db.commit()
        await db.refresh(journey)

        # Seed telemetry locations:
        # Stop 1 (10:00 - 10:05, stationary)
        # Trip 1 (10:05 - 10:15, moving 40 km/h)
        # Stop 2 (10:15 - 10:20, stationary)
        t0 = datetime(2026, 11, 10, 10, 0, 0, tzinfo=timezone.utc)
        pts = [
            # Stop 1
            Location(journey_id=journey.id, latitude=12.9716, longitude=77.5946, speed=0.0, motion=False, distance_m=0.0, total_distance_m=0.0, recorded_at=t0),
            Location(journey_id=journey.id, latitude=12.9716, longitude=77.5946, speed=0.0, motion=False, distance_m=0.0, total_distance_m=0.0, recorded_at=t0 + timedelta(minutes=5)),
            # Trip 1
            Location(journey_id=journey.id, latitude=12.9730, longitude=77.5960, speed=40.0, motion=True, distance_m=500.0, total_distance_m=500.0, recorded_at=t0 + timedelta(minutes=8)),
            Location(journey_id=journey.id, latitude=12.9760, longitude=77.5990, speed=50.0, motion=True, distance_m=600.0, total_distance_m=1100.0, recorded_at=t0 + timedelta(minutes=15)),
            # Stop 2
            Location(journey_id=journey.id, latitude=12.9760, longitude=77.5990, speed=0.0, motion=False, distance_m=0.0, total_distance_m=1100.0, recorded_at=t0 + timedelta(minutes=16)),
            Location(journey_id=journey.id, latitude=12.9760, longitude=77.5990, speed=0.0, motion=False, distance_m=0.0, total_distance_m=1100.0, recorded_at=t0 + timedelta(minutes=20)),
        ]
        db.add_all(pts)
        await db.commit()

    mgr_headers = auth_headers_factory(mgr)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Geofence CRUD
        gf_payload = {
            "name": "Central Hub",
            "kind": "circle",
            "geometry": {"type": "circle", "center": [12.9716, 77.5946], "radius": 200},
        }
        res_gf = await client.post("/api/geofences", json=gf_payload, headers=mgr_headers)
        assert res_gf.status_code == 201
        gf_data = res_gf.json()
        gf_id = gf_data["id"]
        assert "area" in gf_data
        assert "CIRCLE" in gf_data["area"]

        # Test creating geofence via area string (like the frontend form payload)
        gf_area_payload = {
            "name": "Warehouse Perimeter",
            "description": "Logistics depot",
            "area": "CIRCLE (13.03730 80.16487, 500)",
        }
        res_area_gf = await client.post("/api/geofences", json=gf_area_payload, headers=mgr_headers)
        assert res_area_gf.status_code == 201
        area_gf_data = res_area_gf.json()
        assert area_gf_data["kind"] == "circle"
        assert area_gf_data["geometry"]["center"] == [13.0373, 80.16487]
        assert area_gf_data["geometry"]["radius"] == 500.0

        # List geofences
        res_gfs = await client.get("/api/geofences", headers=mgr_headers)
        assert res_gfs.status_code == 200
        assert len(res_gfs.json()) >= 1

        # 2. Positions API
        res_pos = await client.get(f"/api/positions?journey_id={journey.id}&limit=100", headers=mgr_headers)
        assert res_pos.status_code == 200
        assert len(res_pos.json()) == 6

        # 3. Verify Reports endpoints are removed (404 Not Found)
        from_str = t0.isoformat()
        to_str = (t0 + timedelta(hours=1)).isoformat()

        res_route = await client.get(f"/api/reports/route?vehicle_id={veh.id}&from={from_str}&to={to_str}", headers=mgr_headers)
        assert res_route.status_code == 404

        res_trips = await client.get(f"/api/reports/trips?vehicle_id={veh.id}&from={from_str}&to={to_str}", headers=mgr_headers)
        assert res_trips.status_code == 404

        res_stops = await client.get(f"/api/reports/stops?vehicle_id={veh.id}&from={from_str}&to={to_str}", headers=mgr_headers)
        assert res_stops.status_code == 404

        res_sum = await client.get(f"/api/reports/summary?vehicle_id={veh.id}&from={from_str}&to={to_str}", headers=mgr_headers)
        assert res_sum.status_code == 404
