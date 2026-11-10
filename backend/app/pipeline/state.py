"""In-memory telematics device state, per-device execution locks, and diagnostics ring buffers.
"""

import asyncio
from collections import deque
from datetime import datetime
from typing import Dict, Any, Optional, Deque, List


class DeviceRuntimeState:
    """Runtime cache for a single device, containing its serialization lock,
    latest position, motion state machine tracking, and diagnostic telemetry.
    """

    def __init__(self, device_id: str):
        self.device_id = device_id
        self.lock = asyncio.Lock()
        self.last_position: Optional[Dict[str, Any]] = None
        self.recent_positions: Deque[Dict[str, Any]] = deque(maxlen=20)

        # Motion state
        self.motion_streak: bool = False
        self.motion_state: bool = False
        self.motion_position_id: Optional[int] = None
        self.motion_time: Optional[datetime] = None
        self.motion_distance_m: float = 0.0
        self.motion_lat: Optional[float] = None
        self.motion_lng: Optional[float] = None

        # Overspeed state
        self.overspeed_state: bool = False
        self.overspeed_time: Optional[datetime] = None
        self.overspeed_geofence_id: Optional[str] = None

        # Diagnostics & counters
        self.accepted_count: int = 0
        self.rejected_count: int = 0
        self.filtered_count: int = 0
        self.reason_counters: Dict[str, int] = {}
        self.rejected_samples: Deque[Dict[str, Any]] = deque(maxlen=50)
        self.last_ingest_lag_ms: float = 0.0
        self.clock_skew_ms: float = 0.0

    def record_rejection(self, reason: str, point_summary: Dict[str, Any]):
        self.rejected_count += 1
        self.reason_counters[reason] = self.reason_counters.get(reason, 0) + 1
        self.rejected_samples.append({
            "timestamp": datetime.utcnow().isoformat(),
            "reason": reason,
            "sample": point_summary,
        })

    def record_acceptance(self, lag_ms: float, skew_ms: float):
        self.accepted_count += 1
        self.last_ingest_lag_ms = lag_ms
        self.clock_skew_ms = skew_ms

    def record_filtered(self, reason: str):
        self.filtered_count += 1
        self.reason_counters[reason] = self.reason_counters.get(reason, 0) + 1


class DeviceStateManager:
    """Thread-safe singleton registry for device runtime states."""

    _instance: Optional["DeviceStateManager"] = None

    def __init__(self):
        self._devices: Dict[str, DeviceRuntimeState] = {}
        self._global_lock = asyncio.Lock()

    @classmethod
    def get_instance(cls) -> "DeviceStateManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def get_state(self, device_id: str) -> DeviceRuntimeState:
        if device_id not in self._devices:
            async with self._global_lock:
                if device_id not in self._devices:
                    self._devices[device_id] = DeviceRuntimeState(device_id)
        return self._devices[device_id]

    def clear(self):
        """Used in test teardown."""
        self._devices.clear()
