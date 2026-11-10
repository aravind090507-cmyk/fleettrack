"""Integration tests for PipelineRunner database persistence and serialization."""

import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database.base import Base
import app.models  # load all models
from app.models.company import Company
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.journey import Journey
from app.models.location import Location
from app.models.event import Event
from app.pipeline.runner import PipelineRunner
from app.pipeline.reasons import PipelineStatus


@pytest.mark.asyncio
async def test_pipeline_runner_end_to_end():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Seed company, vehicle, device
        company = Company(id="c-test", name="Test Co", invite_code="TEST")
        vehicle = Vehicle(id="v-test", company_id="c-test", registration_number="KA01TEST", model="Truck", vehicle_type="TRUCK")
        device = Device(
            id="d-test",
            company_id="c-test",
            vehicle_id="v-test",
            unique_id="web-v-test",
            name="KA01TEST Tracker",
            status="unknown",
        )
        session.add_all([company, vehicle, device])
        await session.commit()

        runner = PipelineRunner(session)
        t0 = datetime.now(timezone.utc)

        # 1. First ping (stopped)
        ping1 = {
            "latitude": 12.9716,
            "longitude": 77.5946,
            "speed": 0.0,
            "heading": 0.0,
            "accuracy": 8.0,
            "timestamp": t0.isoformat(),
        }
        res1 = await runner.process_position(ping1, device)
        await session.commit()

        assert res1.status == PipelineStatus.RECORDED
        assert res1.position["total_distance_m"] == 0.0
        assert res1.position["motion"] is False

        # 2. Second ping: stationary jitter (+2 meters)
        ping2 = {
            "latitude": 12.97161,
            "longitude": 77.5946,
            "speed": 0.0,
            "heading": 0.0,
            "accuracy": 12.0,
            "timestamp": (t0 + timedelta(seconds=5)).isoformat(),
        }
        res2 = await runner.process_position(ping2, device)
        await session.commit()

        assert res2.status == PipelineStatus.RECORDED
        assert res2.position["distance_m"] == 0.0
        assert res2.position["total_distance_m"] == 0.0
        assert res2.adjusted.get("snapped_to_previous") is True

        # 3. Third ping: moving (40 km/h, moved 50m)
        ping3 = {
            "latitude": 12.97205,
            "longitude": 77.5946,
            "speed": 40.0,
            "heading": 0.0,
            "accuracy": 5.0,
            "timestamp": (t0 + timedelta(seconds=10)).isoformat(),
        }
        res3 = await runner.process_position(ping3, device)
        await session.commit()

        assert res3.status == PipelineStatus.RECORDED
        assert res3.position["distance_m"] > 40.0
        assert res3.position["motion"] is True
        assert len(res3.events) > 0
        assert res3.events[0]["type"] == "deviceMoving"

        # Verify device status updated in DB
        assert device.status == "online"
        assert device.motion_state is True

    await engine.dispose()
