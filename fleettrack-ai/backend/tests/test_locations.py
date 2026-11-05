import pytest
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vehicle import Vehicle
from app.models.gps_device import GPSDevice
from app.core.security import hash_device_token


@pytest.mark.asyncio
async def test_location_ingestion(client: AsyncClient, db_session: AsyncSession):
    # Setup vehicle and device
    v_id = uuid.uuid4()
    d_id = uuid.uuid4()
    raw_token = "secret_gps_token_123"

    veh = Vehicle(
        id=v_id,
        registration_number="TN-TEST-LOC-01",
        vehicle_type="dump_truck",
        device_id=d_id,
        status="idle",
        is_active=True,
    )
    dev = GPSDevice(
        id=d_id,
        device_identifier="GPS-DEV-999",
        device_token_hash=hash_device_token(raw_token),
        device_type="obd2",
        vehicle_id=v_id,
        is_active=True,
    )
    db_session.add_all([veh, dev])
    await db_session.commit()

    # Valid location submission
    payload = {
        "device_id": "GPS-DEV-999",
        "latitude": 13.0827,
        "longitude": 80.2707,
        "speed": 45.0,
        "heading": 90.0,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "device_token": raw_token,
    }
    resp = await client.post("/api/v1/locations", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["status"] == "moving"


@pytest.mark.asyncio
async def test_location_invalid_token_rejected(client: AsyncClient, db_session: AsyncSession):
    payload = {
        "device_id": "GPS-NONEXISTENT",
        "latitude": 13.0827,
        "longitude": 80.2707,
        "speed": 45.0,
        "heading": 90.0,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "device_token": "wrong_token",
    }
    resp = await client.post("/api/v1/locations", json=payload)
    assert resp.status_code == 401
