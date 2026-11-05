"""
Journey Lifecycle Service.
Manages journey dispatch, cryptographically random tracking tokens,
SHA-256 hashing, database persistence, and token revocation.
"""
from __future__ import annotations

import hashlib
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config.settings import get_settings
from app.models.journey import Journey
from app.models.location import Location
from app.models.tracking_link import TrackingLink
from app.models.vehicle import Vehicle
from app.services.redis_service import RedisService
from app.websocket.manager import ConnectionManager

settings = get_settings()


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in kilometers between two lat/lon pairs on WGS84 ellipsoid."""
    R = 6371.0  # Earth's radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


async def create_journey(
    db: AsyncSession,
    driver_id: str,
    vehicle_id: str,
    origin_name: str,
    origin_lat: float,
    origin_lng: float,
    destination_name: str,
    destination_lat: float,
    destination_lng: float,
    description: Optional[str],
    redis_svc: RedisService,
) -> Tuple[Journey, str, str]:
    """
    Initiates a new journey, creates an unguessable 256-bit token,
    hashes it with SHA-256, and links it in Redis and PostgreSQL.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=settings.TRACKING_LINK_EXPIRE_HOURS)

    # 1. Generate 256-bit cryptographic token (base64url encoded string, 43 chars)
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    # 2. Create Journey record
    journey = Journey(
        vehicle_id=vehicle_id,
        driver_id=driver_id,
        origin_name=origin_name,
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        destination_name=destination_name,
        destination_lat=destination_lat,
        destination_lng=destination_lng,
        status="IN_PROGRESS",
        description=description,
        started_at=now,
    )
    db.add(journey)
    await db.flush()  # Populates journey.id

    # 3. Create TrackingLink record with SHA-256 hash (never store raw token in DB)
    tracking_link = TrackingLink(
        journey_id=journey.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(tracking_link)

    # 4. Insert initial Location telemetry breadcrumb at Origin point
    initial_location = Location(
        journey_id=journey.id,
        latitude=origin_lat,
        longitude=origin_lng,
        speed=0.0,
        heading=0.0,
        accuracy=5.0,
        altitude=0.0,
        recorded_at=now,
    )
    db.add(initial_location)

    # 5. Update Vehicle status to IN_TRANSIT
    await db.execute(
        update(Vehicle)
        .where(Vehicle.id == vehicle_id)
        .values(status="IN_TRANSIT")
    )

    await db.commit()
    await db.refresh(journey)

    # 6. Cache token mapping and initial location in Redis with TTL
    await redis_svc.set_tracking_token(
        token_hash=token_hash,
        journey_id=journey.id,
        expire_hours=settings.TRACKING_LINK_EXPIRE_HOURS
    )
    await redis_svc.set_latest_vehicle_location(
        vehicle_id=vehicle_id,
        lat=origin_lat,
        lng=origin_lng,
        speed=0.0,
        heading=0.0,
        timestamp=now.isoformat(),
    )

    # 7. Formulate public tracking URL
    tracking_url = f"{settings.BASE_URL}/track/{raw_token}"
    return journey, raw_token, tracking_url


async def end_journey(
    db: AsyncSession,
    journey_id: str,
    driver_id: str,
    redis_svc: RedisService,
    ws_mgr: ConnectionManager,
) -> Journey:
    """
    Terminates an active journey:
    - Sets journey status to COMPLETED
    - Revokes tracking link and removes from Redis
    - Resets vehicle to AVAILABLE
    - Closes WebSocket tracking connections with code 4410
    """
    stmt = (
        select(Journey)
        .where(Journey.id == journey_id)
        .options(selectinload(Journey.vehicle), selectinload(Journey.tracking_links))
    )
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    if not journey:
        raise ValueError("Journey not found")
    if journey.status == "COMPLETED":
        return journey

    now = datetime.now(timezone.utc)
    # Make started_at timezone-aware for comparison if it is naive
    started_at = journey.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    duration = int((now - started_at).total_seconds())

    # Compute total distance from recorded location points
    loc_stmt = (
        select(Location)
        .where(Location.journey_id == journey_id)
        .order_by(Location.recorded_at.asc())
    )
    loc_result = await db.execute(loc_stmt)
    locations = loc_result.scalars().all()

    total_km = 0.0
    for i in range(1, len(locations)):
        total_km += haversine_distance(
            locations[i - 1].latitude,
            locations[i - 1].longitude,
            locations[i].latitude,
            locations[i].longitude,
        )

    # Update journey
    journey.status = "COMPLETED"
    journey.ended_at = now
    journey.duration_seconds = duration
    journey.total_distance_km = round(total_km, 3)

    # Update vehicle status
    await db.execute(
        update(Vehicle)
        .where(Vehicle.id == journey.vehicle_id)
        .values(status="AVAILABLE")
    )

    # Revoke all tracking link hashes for this journey
    for link in journey.tracking_links:
        link.revoked_at = now
        await redis_svc.revoke_tracking_token(link.token_hash)

    await db.commit()
    await db.refresh(journey)

    # Publish termination event to WebSocket manager
    await ws_mgr.close_journey_connections(
        journey_id=journey.id,
        code=4410,
        reason="Journey has ended. Tracking link is now invalid."
    )
    # Broadcast fleet-wide completion
    await ws_mgr.broadcast_to_fleet({
        "type": "JOURNEY_FINISHED",
        "journey_id": journey.id,
        "vehicle_id": journey.vehicle_id,
        "ended_at": now.isoformat()
    })

    return journey


async def validate_tracking_token(
    db: AsyncSession,
    token: str,
    redis_svc: RedisService,
) -> Optional[Tuple[Journey, TrackingLink]]:
    """
    Validates a tracking token:
    Computes SHA-256(token). Checks Redis and DB.
    Returns (Journey, TrackingLink) if active, or None if expired/revoked.
    """
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)

    # Fast path: check Redis
    cached_journey_id = await redis_svc.get_journey_id_by_token_hash(token_hash)

    stmt = (
        select(TrackingLink)
        .where(TrackingLink.token_hash == token_hash)
        .options(
            selectinload(TrackingLink.journey).selectinload(Journey.vehicle),
            selectinload(TrackingLink.journey).selectinload(Journey.driver),
        )
    )
    result = await db.execute(stmt)
    tracking_link = result.scalar_one_or_none()

    if not tracking_link:
        return None

    # Verify not revoked
    if tracking_link.revoked_at is not None:
        return None

    # Verify not expired
    expires_at = tracking_link.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        return None

    journey = tracking_link.journey
    if journey.status != "IN_PROGRESS":
        return None

    # Increment access counter
    tracking_link.access_count += 1
    await db.commit()

    return journey, tracking_link
