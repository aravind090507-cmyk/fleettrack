"""Event detector ported from Traccar event handlers.
Generates structured events for motion transitions, geofence enter/exit, and overspeed.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set
import uuid

from app.pipeline.events.types import EventType
from app.pipeline.config import lookup_config


class EventDetector:
    """Evaluates state transitions between consecutive positions and generates events."""

    def __init__(self, config_dict: Optional[Dict[str, Any]] = None):
        self.config = config_dict or {}

    def detect(
        self,
        position: Dict[str, Any],
        last_position: Optional[Dict[str, Any]],
        device_attributes: Optional[Dict[str, Any]] = None,
        company_id: Optional[str] = None,
        device_id: Optional[str] = None,
        journey_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Compares current and prior state to produce events."""
        events: List[Dict[str, Any]] = []
        event_time = position.get("recorded_at") or position.get("device_time") or datetime.now(timezone.utc)
        curr_motion = bool(position.get("motion", False))
        curr_speed = float(position.get("speed", 0.0) or 0.0)

        # 1. Motion Events (deviceMoving / deviceStopped)
        if last_position is not None:
            prev_motion = bool(last_position.get("motion", False))
            if curr_motion != prev_motion:
                event_type = EventType.DEVICE_MOVING if curr_motion else EventType.DEVICE_STOPPED
                events.append({
                    "id": f"evt-{uuid.uuid4()}",
                    "company_id": company_id,
                    "device_id": device_id,
                    "journey_id": journey_id,
                    "type": event_type.value,
                    "event_time": event_time,
                    "attributes": {
                        "speed": curr_speed,
                        "latitude": position.get("latitude"),
                        "longitude": position.get("longitude"),
                    },
                })

        # 2. Overspeed Event (deviceOverspeed)
        overspeed_threshold = lookup_config("speed.overspeedThreshold", device_attributes, self.config, 100.0)
        if overspeed_threshold > 0 and curr_speed > overspeed_threshold:
            # Check if this is a new overspeed instance
            prev_speed = float(last_position.get("speed", 0.0) or 0.0) if last_position else 0.0
            if prev_speed <= overspeed_threshold:
                events.append({
                    "id": f"evt-{uuid.uuid4()}",
                    "company_id": company_id,
                    "device_id": device_id,
                    "journey_id": journey_id,
                    "type": EventType.DEVICE_OVERSPEED.value,
                    "event_time": event_time,
                    "attributes": {
                        "speed": curr_speed,
                        "speed_limit": overspeed_threshold,
                        "latitude": position.get("latitude"),
                        "longitude": position.get("longitude"),
                    },
                })

        # 3. Geofence Events (geofenceEnter / geofenceExit)
        curr_geofences: Set[str] = set(position.get("geofence_ids") or [])
        prev_geofences: Set[str] = set(last_position.get("geofence_ids") or []) if last_position else set()

        entered = curr_geofences - prev_geofences
        for gf_id in entered:
            events.append({
                "id": f"evt-{uuid.uuid4()}",
                "company_id": company_id,
                "device_id": device_id,
                "journey_id": journey_id,
                "geofence_id": gf_id,
                "type": EventType.GEOFENCE_ENTER.value,
                "event_time": event_time,
                "attributes": {
                    "geofence_id": gf_id,
                    "latitude": position.get("latitude"),
                    "longitude": position.get("longitude"),
                },
            })

        exited = prev_geofences - curr_geofences
        for gf_id in exited:
            events.append({
                "id": f"evt-{uuid.uuid4()}",
                "company_id": company_id,
                "device_id": device_id,
                "journey_id": journey_id,
                "geofence_id": gf_id,
                "type": EventType.GEOFENCE_EXIT.value,
                "event_time": event_time,
                "attributes": {
                    "geofence_id": gf_id,
                    "latitude": position.get("latitude"),
                    "longitude": position.get("longitude"),
                },
            })

        return events
