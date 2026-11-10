"""Tests for OsmAnd protocol ingestion and Device diagnostics endpoint."""

import pytest
import uuid
from httpx import AsyncClient, ASGITransport
from datetime import datetime, timezone
from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.location import Location
from app.security.passwords import hash_password
from sqlalchemy import select
import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()


@pytest.mark.asyncio
async def test_osmand_and_device_diagnostics(auth_headers_factory):
    async with AsyncSessionLocal() as db:
        comp = Company(name="OsmAnd Fleet Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        mgr = User(
            company_id=comp.id,
            name="OsmAnd Manager",
            email=f"osmand_mgr_{uuid.uuid4().hex[:6]}@fleet.com",
            password_hash=hash_password("Password123!"),
            role="FLEET_MANAGER",
            is_active=True,
        )
        veh = Vehicle(
            company_id=comp.id,
            registration_number=f"OSM-{uuid.uuid4().hex[:4].upper()}",
            model="OsmAnd Truck",
            vehicle_type="TRUCK",
        )
        db.add_all([mgr, veh])
        await db.commit()
        await db.refresh(mgr)
        await db.refresh(veh)

        device = Device(
            id=f"dev-osmand-{uuid.uuid4().hex[:6]}",
            company_id=comp.id,
            unique_id=f"osm-{uuid.uuid4().hex[:6]}",
            name="OsmAnd Phone Tracker",
            vehicle_id=veh.id,
            status="unknown",
        )
        db.add(device)
        await db.commit()
        await db.refresh(device)

    mgr_headers = auth_headers_factory(mgr)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        now_epoch = int(datetime.now(timezone.utc).timestamp())
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Test GET /api/osmand
        res_get = await client.get(
            f"/api/osmand?id={device.unique_id}&lat=12.9716&lon=77.5946&timestamp={now_epoch}&speed=15.0&bearing=120.0&altitude=920.0&accuracy=6.0"
        )
        assert res_get.status_code == 200
        assert res_get.text == "OK"

        # 2. Test POST /api/osmand (JSON payload)
        payload = {
            "id": device.unique_id,
            "lat": 12.9730,
            "lon": 77.5960,
            "timestamp": now_iso,
            "speed": 22.0,
            "bearing": 130.0,
            "altitude": 925.0,
            "accuracy": 4.5,
            "batt": 92.0,
            "charge": True,
        }
        res_post = await client.post("/api/osmand", json=payload)
        assert res_post.status_code == 200
        assert res_post.text == "OK"

        # 3. Verify location records persisted in DB with protocol="osmand"
        async with AsyncSessionLocal() as db:
            stmt = select(Location).where(Location.device_id == device.id).order_by(Location.recorded_at.desc())
            locs = (await db.execute(stmt)).scalars().all()
            assert len(locs) >= 2
            assert locs[0].protocol == "osmand"
            assert locs[0].latitude == 12.9730

        # 4. Test GET /api/devices/{id}/diagnostics
        res_diag = await client.get(f"/api/devices/{device.id}/diagnostics", headers=mgr_headers)
        assert res_diag.status_code == 200
        diag = res_diag.json()
        assert diag["device_id"] == device.id
        assert diag["unique_id"] == device.unique_id
        assert diag["status"] == "online"
        assert diag["accepted_count"] >= 2
        assert isinstance(diag["reason_counters"], dict)
        assert isinstance(diag["rejected_samples"], list)
