"""Pipeline coordinator and execution runner.
Executes telematics positions through ordered handlers under per-device serialization lock,
persists positions and events, updates device status, and emits events.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Union
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.device import Device
from app.models.location import Location
from app.models.event import Event
from app.models.journey import Journey
from app.pipeline.reasons import PipelineStatus, ReasonCode
from app.pipeline.state import DeviceStateManager, DeviceRuntimeState
from app.pipeline.handlers.time import TimeHandler
from app.pipeline.handlers.outdated import OutdatedHandler
from app.pipeline.handlers.filter import FilterHandler
from app.pipeline.handlers.distance import DistanceHandler
from app.pipeline.handlers.motion import MotionHandler
from app.pipeline.handlers.geofence import GeofenceHandler
from app.pipeline.events.detector import EventDetector


class PipelineResult:
    """Structured result returned by the pipeline runner for each position."""

    def __init__(
        self,
        status: PipelineStatus,
        reasons: List[str],
        position: Optional[Dict[str, Any]] = None,
        location_id: Optional[str] = None,
        events: Optional[List[Dict[str, Any]]] = None,
        adjusted: Optional[Dict[str, Any]] = None,
    ):
        self.status = status
        self.reasons = reasons
        self.position = position or {}
        self.location_id = location_id
        self.events = events or []
        self.adjusted = adjusted or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status.value,
            "reasons": self.reasons,
            "location_id": self.location_id,
            "events_count": len(self.events),
            "adjusted": self.adjusted,
        }


class PipelineRunner:
    """Coordinates handler pipeline for telematics positions."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.state_mgr = DeviceStateManager.get_instance()
        self.time_handler = TimeHandler()
        self.outdated_handler = OutdatedHandler()
        self.filter_handler = FilterHandler()
        self.distance_handler = DistanceHandler()
        self.motion_handler = MotionHandler()
        self.geofence_handler = GeofenceHandler()
        self.event_detector = EventDetector()

    async def process_position(
        self,
        raw_ping: Dict[str, Any],
        device: Device,
        journey: Optional[Journey] = None,
        geofences: Optional[List[Dict[str, Any]]] = None,
        protocol: str = "web",
    ) -> PipelineResult:
        """Processes a single position for a device under per-device lock."""
        start_time = datetime.now(timezone.utc)
        dev_state = await self.state_mgr.get_state(device.id)

        async with dev_state.lock:
            # Prepare position dict
            ts = raw_ping.get("timestamp")
            if isinstance(ts, str):
                try:
                    recorded_at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception:
                    recorded_at = datetime.now(timezone.utc)
            elif isinstance(ts, datetime):
                recorded_at = ts
            else:
                recorded_at = datetime.now(timezone.utc)

            pos: Dict[str, Any] = {
                "latitude": float(raw_ping.get("latitude", 0.0)),
                "longitude": float(raw_ping.get("longitude", 0.0)),
                "speed": float(raw_ping.get("speed", 0.0) or 0.0),
                "heading": float(raw_ping.get("heading", 0.0) or 0.0),
                "accuracy": float(raw_ping.get("accuracy", 0.0) or 0.0),
                "recorded_at": recorded_at,
                "device_time": recorded_at,
                "valid": bool(raw_ping.get("valid", True)),
                "protocol": protocol,
                "attributes": raw_ping.get("attributes") or {},
            }

            device_attrs = device.attributes or {}
            reasons: List[str] = []
            adjusted_all: Dict[str, Any] = {}

            # 1. Device check
            if device.disabled:
                dev_state.record_rejection(ReasonCode.REJECTED_DEVICE_DISABLED.value, pos)
                return PipelineResult(PipelineStatus.REJECTED, [ReasonCode.REJECTED_DEVICE_DISABLED.value])

            # 2. Time handler
            time_valid, time_reason, time_adj = self.time_handler.process(
                pos, device_attrs, server_time=start_time
            )
            if not time_valid and time_reason:
                dev_state.record_rejection(time_reason.value, pos)
                return PipelineResult(PipelineStatus.REJECTED, [time_reason.value])
            if time_adj:
                pos.update(time_adj)
                adjusted_all.update(time_adj)
                if "skew_adjusted" in time_adj:
                    reasons.append(ReasonCode.ADJUSTED_CLOCK_SKEW.value)

            # Retrieve last position from runtime cache or database
            last_pos = dev_state.last_position
            if last_pos is None:
                # Query last position from DB
                stmt = (
                    select(Location)
                    .where(Location.device_id == device.id)
                    .order_by(Location.recorded_at.desc())
                    .limit(1)
                )
                db_loc = (await self.session.execute(stmt)).scalars().first()
                if db_loc:
                    last_pos = {
                        "latitude": db_loc.latitude,
                        "longitude": db_loc.longitude,
                        "speed": db_loc.speed,
                        "heading": db_loc.heading,
                        "recorded_at": db_loc.recorded_at,
                        "total_distance_m": db_loc.total_distance_m,
                        "motion": db_loc.motion,
                        "geofence_ids": db_loc.geofence_ids or [],
                    }
                    dev_state.last_position = last_pos

            # If device enters a new active journey, ensure last_position does not bridge from an old journey
            if journey and journey.started_at:
                j_started = journey.started_at.replace(tzinfo=timezone.utc) if journey.started_at.tzinfo is None else journey.started_at
                if last_pos and last_pos.get("recorded_at"):
                    lp_rec = last_pos["recorded_at"]
                    if lp_rec.tzinfo is None:
                        lp_rec = lp_rec.replace(tzinfo=timezone.utc)
                    if lp_rec < j_started:
                        # Reset tracking baseline to journey origin
                        last_pos = {
                            "latitude": journey.origin_lat,
                            "longitude": journey.origin_lng,
                            "speed": 0.0,
                            "heading": 0.0,
                            "recorded_at": j_started,
                            "total_distance_m": 0.0,
                            "motion": False,
                            "geofence_ids": [],
                        }
                        dev_state.last_position = last_pos

            # 3. Outdated handler
            is_outdated, _ = self.outdated_handler.process(pos, last_pos)
            pos["outdated"] = is_outdated
            if is_outdated:
                reasons.append(ReasonCode.FILTERED_OUTDATED.value)

            # 4. Filter handler
            passes_filter, filter_reason = self.filter_handler.process(pos, last_pos, device_attrs)
            if not passes_filter and filter_reason:
                dev_state.record_rejection(filter_reason.value, pos)
                return PipelineResult(PipelineStatus.FILTERED, [filter_reason.value])

            # 5. Distance handler (with jitter snap gate)
            dist_m, total_dist_m, dist_adj = self.distance_handler.process(pos, last_pos, device_attrs)
            pos["distance_m"] = dist_m
            pos["total_distance_m"] = total_dist_m
            if dist_adj:
                pos.update(dist_adj)
                adjusted_all.update(dist_adj)
                if dist_adj.get("snapped_to_previous"):
                    reasons.append(ReasonCode.ADJUSTED_JITTER_SNAP.value)

            # 6. Motion handler
            motion = self.motion_handler.process(pos, device_attrs)
            pos["motion"] = motion

            # 7. Geofence handler
            active_geofences = geofences or []
            matched_gfs = self.geofence_handler.process(pos, active_geofences)
            pos["geofence_ids"] = matched_gfs

            # 8. Event detector
            events = self.event_detector.detect(
                pos,
                last_pos,
                device_attributes=device_attrs,
                company_id=device.company_id,
                device_id=device.id,
                journey_id=journey.id if journey else None,
            )

            # 9. Persist Location to Database
            # Ensure all values in attributes dict are JSON serializable
            safe_attributes = {}
            for k, v in {**pos.get("attributes", {}), **adjusted_all}.items():
                if isinstance(v, datetime):
                    safe_attributes[k] = v.isoformat()
                elif isinstance(v, (str, int, float, bool, list, dict, type(None))):
                    safe_attributes[k] = v
                else:
                    safe_attributes[k] = str(v)

            rec_at = pos["recorded_at"]
            if hasattr(rec_at, "tzinfo") and rec_at.tzinfo is not None:
                rec_at = rec_at.replace(tzinfo=None)

            dev_time = pos.get("device_time")
            if hasattr(dev_time, "tzinfo") and dev_time.tzinfo is not None:
                dev_time = dev_time.replace(tzinfo=None)

            location_record = Location(
                journey_id=journey.id if journey else None,
                device_id=device.id,
                latitude=pos["latitude"],
                longitude=pos["longitude"],
                speed=pos["speed"],
                heading=pos.get("heading", 0.0),
                accuracy=pos.get("accuracy", 0.0),
                recorded_at=rec_at,
                device_time=dev_time,
                valid=pos.get("valid", True),
                outdated=pos.get("outdated", False),
                protocol=protocol,
                distance_m=pos["distance_m"],
                total_distance_m=pos["total_distance_m"],
                motion=pos["motion"],
                geofence_ids=pos["geofence_ids"],
                attributes=safe_attributes,
            )
            self.session.add(location_record)

            # Persist Events
            for evt_data in events:
                e_time = evt_data.get("event_time")
                if hasattr(e_time, "tzinfo") and e_time.tzinfo is not None:
                    e_time = e_time.replace(tzinfo=None)
                evt_record = Event(
                    id=evt_data["id"],
                    company_id=evt_data["company_id"],
                    device_id=evt_data["device_id"],
                    journey_id=evt_data.get("journey_id"),
                    geofence_id=evt_data.get("geofence_id"),
                    type=evt_data["type"],
                    event_time=e_time,
                    attributes=evt_data.get("attributes"),
                )
                self.session.add(evt_record)

            # 10. Update Device State & Tracking in DB and Cache
            device.status = "online"
            device.last_update = rec_at
            device.motion_state = pos["motion"]

            # Update Journey summary if active journey exists (accumulate real journey distance, not device odometer)
            if journey and journey.status == "IN_PROGRESS" and not pos.get("outdated", False):
                delta_km = pos.get("distance_m", 0.0) / 1000.0
                if delta_km > 0:
                    journey.total_distance_km = round((journey.total_distance_km or 0.0) + delta_km, 3)

            # Update cache
            dev_state.last_position = pos
            dev_state.motion_state = pos["motion"]
            lag_ms = (datetime.now(timezone.utc) - pos["recorded_at"]).total_seconds() * 1000.0
            dev_state.record_acceptance(lag_ms, adjusted_all.get("clockSkewMs", 0.0))

            return PipelineResult(
                status=PipelineStatus.RECORDED,
                reasons=reasons,
                position=pos,
                location_id=str(location_record.id) if location_record.id else None,
                events=events,
                adjusted=adjusted_all,
            )
