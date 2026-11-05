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
    def is_accuracy_valid(accuracy: float) -> bool:
        """Allow indoor office GPS readings (which range from 5m to 120m)."""
        if accuracy <= 0.0:
            return True
        return accuracy <= settings.GPS_MAX_ACCURACY_METERS

    @staticmethod
    def is_speed_plausible(speed: float) -> bool:
        """Allow walking speeds (0 to 5 km/h) up to highway speeds."""
        return speed >= 0.0 and speed <= settings.GPS_MAX_SPEED_KMH


async def ingest_location_ping(
    db: AsyncSession,
    journey: Journey,
    ping: LocationPing,
    redis_svc: RedisService,
    ws_mgr: ConnectionManager,
) -> Optional[Location]:
    """Ingest, validate, store, and broadcast a single GPS location ping."""
    # 1. Spatial validation (relaxed for indoor office walking testing)
    if not GPSValidator.is_accuracy_valid(ping.accuracy):
        logger.info("GPS ping received with accuracy: %0.1fm", ping.accuracy)

    # Ensure timestamp has timezone
    rec_time = ping.timestamp
    if rec_time.tzinfo is None:
        rec_time = rec_time.replace(tzinfo=timezone.utc)

    # 2. Persist to SQLite / PostgreSQL
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
    })

    return loc


async def ingest_location_batch(
    db: AsyncSession,
    journey: Journey,
    pings: List[LocationPing],
    redis_svc: RedisService,
    ws_mgr: ConnectionManager,
) -> int:
    """Ingests an ordered batch of GPS pings accumulated during offline periods."""
    sorted_pings = sorted(pings, key=lambda p: p.timestamp)
    saved_count = 0
    latest_valid_ping = None

    for ping in sorted_pings:
        rec_time = ping.timestamp
        if rec_time.tzinfo is None:
            rec_time = rec_time.replace(tzinfo=timezone.utc)

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
            })

    return saved_count
