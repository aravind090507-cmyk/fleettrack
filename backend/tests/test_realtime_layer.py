"""Tests for Phase 5 Real-Time Layer:
- Coalesced WebSocket envelope batching
- Tracking token access counter throttling
- Bulk set-based dashboard queries
"""

import pytest
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.database.session import AsyncSessionLocal, init_db
from app.models.company import Company
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.models.tracking_link import TrackingLink
from app.websocket.manager import ConnectionManager
from app.services.journey_service import validate_tracking_token
from app.services.redis_service import get_redis_service
from app.security.passwords import hash_password


@pytest.mark.asyncio
async def test_coalesced_websocket_envelope():
    ws_mgr = ConnectionManager()
    received_messages = []

    class MockWebSocket:
        async def send_text(self, text: str):
            received_messages.append(text)

    mock_ws = MockWebSocket()
    # Connect fleet console for company 'c-envelope'
    ws_mgr.fleet_company_subscribers["c-envelope"] = [mock_ws]

    # Queue 3 updates within 100ms
    await ws_mgr.queue_coalesced_update(
        company_id="c-envelope",
        position={"latitude": 12.9716, "longitude": 77.5946, "speed": 35.0},
    )
    await ws_mgr.queue_coalesced_update(
        company_id="c-envelope",
        position={"latitude": 12.9720, "longitude": 77.5950, "speed": 40.0},
    )
    await ws_mgr.queue_coalesced_update(
        company_id="c-envelope",
        event={"type": "deviceMoving", "attributes": {"speed": 40.0}},
    )

    # Immediately after queuing, flush should NOT have happened yet
    assert len(received_messages) == 0

    # Wait for the 200ms coalesce timer to trigger
    await asyncio.sleep(0.3)

    # Assert coalesced envelope arrived
    assert len(received_messages) == 1
    import json
    envelope = json.loads(received_messages[0])
    assert envelope["type"] == "ENVELOPE"
    assert len(envelope["positions"]) == 2
    assert len(envelope["events"]) == 1


@pytest.mark.asyncio
async def test_token_access_throttling():
    await init_db()
    async with AsyncSessionLocal() as db:
        comp = Company(name="Throttle Co", invite_code=uuid.uuid4().hex[:8].upper())
        db.add(comp)
        await db.commit()
        await db.refresh(comp)

        drv = User(
            company_id=comp.id,
            name="Driver",
            email=f"drv_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("Pass123!"),
            role="DRIVER",
            is_active=True,
        )
        veh = Vehicle(company_id=comp.id, registration_number=f"TR-{uuid.uuid4().hex[:4]}", model="M", vehicle_type="VAN")
        db.add_all([drv, veh])
        await db.commit()
        await db.refresh(drv)
        await db.refresh(veh)

        journey = Journey(
            company_id=comp.id,
            vehicle_id=veh.id,
            driver_id=drv.id,
            origin_name="A",
            origin_lat=12.0,
            origin_lng=77.0,
            destination_name="B",
            destination_lat=13.0,
            destination_lng=78.0,
            status="IN_PROGRESS",
        )
        db.add(journey)
        await db.commit()
        await db.refresh(journey)

        raw_token = f"tok_{uuid.uuid4().hex}"
        import hashlib
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        link = TrackingLink(
            journey_id=journey.id,
            token_hash=token_hash,
            access_count=0,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
            created_at=datetime.now(timezone.utc),
        )
        db.add(link)
        await db.commit()

        redis_svc = get_redis_service()

        # Validate token 10 times in rapid succession
        for _ in range(10):
            res = await validate_tracking_token(db, raw_token, redis_svc)
            assert res is not None

        # Verify access_count in DB was throttled (committed only once instead of 10 writes!)
        stmt = select(TrackingLink).where(TrackingLink.token_hash == token_hash)
        updated_link = (await db.execute(stmt)).scalar_one()
        assert updated_link.access_count == 1
