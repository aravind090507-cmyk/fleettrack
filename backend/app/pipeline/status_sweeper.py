"""Background sweeper task for device status timeouts.
Periodically marks devices as 'unknown' or 'offline' when no positions have been received.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import select, update
from app.database.session import AsyncSessionLocal
from app.models.device import Device
from app.models.event import Event
from app.pipeline.events.types import EventType
import uuid


class DeviceStatusSweeper:
    """Sweeper that detects offline/stale devices."""

    def __init__(self, timeout_seconds: int = 120, check_interval_seconds: int = 30):
        self.timeout_seconds = timeout_seconds
        self.check_interval_seconds = check_interval_seconds
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def sweep(self):
        """Runs a single sweep pass across all devices."""
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=self.timeout_seconds)
        async with AsyncSessionLocal() as session:
            stmt = (
                select(Device)
                .where(
                    Device.status == "online",
                    Device.last_update < cutoff,
                    Device.disabled == False,
                )
            )
            result = await session.execute(stmt)
            stale_devices = result.scalars().all()

            for dev in stale_devices:
                dev.status = "unknown"
                event = Event(
                    id=f"evt-{uuid.uuid4()}",
                    company_id=dev.company_id,
                    device_id=dev.id,
                    type=EventType.DEVICE_UNKNOWN.value,
                    event_time=datetime.now(timezone.utc),
                    attributes={"previous_status": "online", "last_update": dev.last_update.isoformat() if dev.last_update else None},
                )
                session.add(event)

            if stale_devices:
                await session.commit()

    async def run_loop(self):
        self._running = True
        while self._running:
            try:
                await self.sweep()
            except Exception:
                pass
            await asyncio.sleep(self.check_interval_seconds)

    def start(self):
        if not self._running:
            self._task = asyncio.create_task(self.run_loop())

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
