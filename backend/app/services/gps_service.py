"""
GPS Telemetry Ingestion and Validation Service.
Optimized for high-speed highway fleets as well as micro-distance tests (10-meter office walks).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import get_settings
from app.models.journey import Journey
from app.models.location import Location
from app.schemas.location import LocationPing
from app.services.journey_service import haversine_distance
from app.services.redis_service import RedisService
from app.websocket.manager import ConnectionManager

logger = logging.getLogger("fleettrack.gps")
settings = get_settings()


class GPSValidator:
    """Enforces spatial sanity and noise filtering on mobile telemetry."""

    @staticmethod
    def are_coordinates_valid(lat: float, lng: float) -> bool:
        """Validate latitude in [-90, 90] and longitude in [-180, 180]."""
        return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0

    @staticmethod
    def is_timestamp_valid(ts: datetime) -> bool:
        """Reject future timestamps (> 60s) or stale timestamps (> 24 hours)."""
        now = datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        delta_sec = (now - ts).total_seconds()
        return -60.0 <= delta_sec <= 86400.0

    @staticmethod
    def is_accuracy_valid(accuracy: float) -> bool:
        """Allow GPS readings with accuracy up to 150m (filters cell tower jumps)."""
        if accuracy <= 0.0:
            return True
        return accuracy <= settings.GPS_MAX_ACCURACY_METERS

    @staticmethod
    def is_speed_plausible(speed: float) -> bool:
        """Reject impossible road speeds (> 180 km/h)."""
        return 0.0 <= speed <= settings.GPS_MAX_SPEED_KMH

    @staticmethod
    def is_displacement_plausible(
        lat1: float, lng1: float, t1: datetime,
        lat2: float, lng2: float, t2: datetime
    ) -> bool:
        """Check for impossible teleportation jumps (> 200 km/h)."""
        dist_km = haversine_distance(lat1, lng1, lat2, lng2)
        dt_sec = abs((t2 - t1).total_seconds())
        if dt_sec < 1.0:
            return dist_km < 0.06  # Max 60m in sub-second jitter
        speed_kmh = dist_km / (dt_sec / 3600.0)
        return speed_kmh <= 200.0


# Cache to track last ping timestamp per journey for rate limiting
_last_ping_cache: dict[str, float] = {}


async def ingest_location_ping(
    db: AsyncSession,
    journey: Journey,
    ping: LocationPing,
    redis_svc: RedisService,
    ws_mgr: ConnectionManager,
) -> Optional[Location]:
    """Ingest, validate, store, and broadcast a single GPS location ping."""
    # 1. Bounds and coordinate check
    if not GPSValidator.are_coordinates_valid(ping.latitude, ping.longitude):
        logger.warning("Rejected ping with out-of-bounds coordinates: (%s, %s)", ping.latitude, ping.longitude)
        return None

    # 2. Timestamp check
    rec_time = ping.timestamp
    if rec_time.tzinfo is None:
        rec_time = rec_time.replace(tzinfo=timezone.utc)

    if not GPSValidator.is_timestamp_valid(rec_time):
        logger.warning("Rejected ping with out-of-window timestamp: %s", rec_time)
        return None

    # 3. Accuracy filtering
    if not GPSValidator.is_accuracy_valid(ping.accuracy):
        logger.info("GPS ping filtered due to high inaccuracy: %0.1fm", ping.accuracy)
        return None

    # 4. Speed plausibility
    if not GPSValidator.is_speed_plausible(ping.speed):
        logger.warning("Rejected ping with implausible speed: %s km/h", ping.speed)
        return None

    # 5. Rate limiting per journey (maximum 1 ping every 0.75 seconds)
    import time
    now_mono = time.monotonic()
    last_mono = _last_ping_cache.get(journey.id, 0.0)
    if now_mono - last_mono < 0.75:
        # Throttle without error
        return None
    _last_ping_cache[journey.id] = now_mono

    # 6. Persist to SQLite / PostgreSQL
    loc = Location(
        journey_id=journey.id,
        latitude=ping.latitude,
        longitude=ping.longitude,
        speed=ping.speed,
        heading=ping.heading,
        accuracy=ping.accuracy,
        altitude=ping.altitude,
        recorded_at=rec_time,
    )
    db.add(loc)
    await db.commit()
    await db.refresh(loc)

    # 3. Update Redis Hot Cache
    await redis_svc.set_latest_vehicle_location(
        vehicle_id=journey.vehicle_id,
        lat=ping.latitude,
        lng=ping.longitude,
        speed=ping.speed,
        heading=ping.heading,
        timestamp=rec_time.isoformat(),
    )

    # 4. Formulate telemetry event payload
    payload = {
        "type": "LOCATION_UPDATE",
        "journey_id": journey.id,
        "vehicle_id": journey.vehicle_id,
        "latitude": ping.latitude,
        "longitude": ping.longitude,
        "speed": ping.speed,
        "heading": ping.heading,
        "accuracy": ping.accuracy,
        "altitude": ping.altitude,
        "recorded_at": rec_time.isoformat(),
    }

    # 5. Distribute over Redis Pub/Sub
    await redis_svc.publish_location_update(journey.id, payload)

    # 6. Push directly to active WebSocket subscribers
    await ws_mgr.broadcast_to_journey(journey.id, payload)
    await ws_mgr.broadcast_to_fleet({
        "type": "VEHICLE_MOVED",
        **payload
    }, company_id=journey.company_id)

    return loc


async def ingest_location_batch(
    db: AsyncSession,
    journey: Journey,
    pings: List[LocationPing],
    redis_svc: RedisService,
    ws_mgr: ConnectionManager,
) -> int:
    """Ingests an ordered, deduplicated batch of GPS pings accumulated during offline periods."""
    # Deduplicate by (timestamp, lat, lng)
    seen = set()
    unique_pings: List[LocationPing] = []
    for p in pings:
        key = (p.timestamp.isoformat(), round(p.latitude, 6), round(p.longitude, 6))
        if key not in seen:
            seen.add(key)
            unique_pings.append(p)

    sorted_pings = sorted(unique_pings, key=lambda p: p.timestamp)
    saved_count = 0
    latest_valid_ping = None

    for ping in sorted_pings:
        # Validate coordinates & timestamp
        if not GPSValidator.are_coordinates_valid(ping.latitude, ping.longitude):
            continue
        rec_time = ping.timestamp
        if rec_time.tzinfo is None:
            rec_time = rec_time.replace(tzinfo=timezone.utc)
        if not GPSValidator.is_timestamp_valid(rec_time):
            continue
        if not GPSValidator.is_accuracy_valid(ping.accuracy):
            continue

        loc = Location(
            journey_id=journey.id,
            latitude=ping.latitude,
            longitude=ping.longitude,
            speed=ping.speed,
            heading=ping.heading,
            accuracy=ping.accuracy,
            altitude=ping.altitude,
            recorded_at=rec_time,
        )
        db.add(loc)
        saved_count += 1
        latest_valid_ping = ping

    if saved_count > 0:
        await db.commit()

        if latest_valid_ping:
            rec_time = latest_valid_ping.timestamp
            if rec_time.tzinfo is None:
                rec_time = rec_time.replace(tzinfo=timezone.utc)

            await redis_svc.set_latest_vehicle_location(
                vehicle_id=journey.vehicle_id,
                lat=latest_valid_ping.latitude,
                lng=latest_valid_ping.longitude,
                speed=latest_valid_ping.speed,
                heading=latest_valid_ping.heading,
                timestamp=rec_time.isoformat(),
            )

            batch_payload = {
                "type": "LOCATION_UPDATE",
                "journey_id": journey.id,
                "vehicle_id": journey.vehicle_id,
                "latitude": latest_valid_ping.latitude,
                "longitude": latest_valid_ping.longitude,
                "speed": latest_valid_ping.speed,
                "heading": latest_valid_ping.heading,
                "accuracy": latest_valid_ping.accuracy,
                "recorded_at": rec_time.isoformat(),
                "batch_synced_count": saved_count,
            }
            await redis_svc.publish_location_update(journey.id, batch_payload)
            await ws_mgr.broadcast_to_journey(journey.id, batch_payload)
            await ws_mgr.broadcast_to_fleet({
                "type": "VEHICLE_MOVED",
                **batch_payload
            }, company_id=journey.company_id)

    return saved_count
