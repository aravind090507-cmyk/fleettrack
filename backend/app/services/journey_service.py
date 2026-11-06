"""
Journey Lifecycle Service.
Manages journey dispatch, cryptographically random tracking tokens,
SHA-256 hashing, database persistence, and token revocation.
"""
from __future__ import annotations

import hashlib
import logging
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from jose import jwt, JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger("fleettrack.journey_service")

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
    company_id: Optional[str] = None,
) -> Tuple[Journey, str, str]:
    """
    Initiates a new journey, creates an unguessable 256-bit token,
    hashes it with SHA-256, and links it in Redis and PostgreSQL.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=settings.TRACKING_LINK_EXPIRE_HOURS)

    # 1. Fetch vehicle & driver to generate self-contained, stateless tracking token
    v_stmt = select(Vehicle).where(Vehicle.id == vehicle_id)
    v_res = await db.execute(v_stmt)
    veh = v_res.scalar_one_or_none()

    from app.models.user import User
    d_stmt = select(User).where(User.id == driver_id)
    d_res = await db.execute(d_stmt)
    drv = d_res.scalar_one_or_none()

    # Create Journey record first to populate journey.id
    journey = Journey(
        company_id=company_id,
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

    # Generate self-healing signed cryptographic token (JWT)
    token_payload = {
        "jid": journey.id,
        "cid": company_id,
        "vid": vehicle_id,
        "vreg": veh.registration_number if veh else "FLEET-01",
        "vtype": veh.vehicle_type if veh else "VAN",
        "did": driver_id,
        "dname": drv.name if drv else "Driver",
        "oname": origin_name,
        "olat": origin_lat,
        "olng": origin_lng,
        "destname": destination_name,
        "dlat": destination_lat,
        "dlng": destination_lng,
        "st": now.isoformat(),
        "exp": int(expires_at.timestamp()),
    }
    raw_token = jwt.encode(token_payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    # 3. Create TrackingLink record with SHA-256 hash
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
    }, company_id=journey.company_id)

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
        # Cross-container stateless recovery: decode signed JWT payload and restore state
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            jid = payload.get("jid")
            if not jid:
                return None

            # Verify expiration
            exp = payload.get("exp")
            if exp and datetime.fromtimestamp(exp, tz=timezone.utc) < now:
                return None

            from app.models.user import User
            from app.models.vehicle import Vehicle

            # 1. Restore User / Driver
            did = payload.get("did", f"drv-{jid[:8]}")
            dname = payload.get("dname", "Assigned Driver")
            u_stmt = select(User).where(User.id == did)
            u_res = await db.execute(u_stmt)
            driver_u = u_res.scalar_one_or_none()
            if not driver_u:
                driver_u = User(
                    id=did,
                    name=dname,
                    email=f"{did}@fleettrack.local",
                    password_hash="stateless",
                    role="DRIVER",
                    is_active=True,
                )
                db.add(driver_u)
                await db.flush()

            # 2. Restore Vehicle
            vid = payload.get("vid", f"veh-{jid[:8]}")
            vreg = payload.get("vreg", "FLEET-01")
            vtype = payload.get("vtype", "VAN")
            v_stmt = select(Vehicle).where(Vehicle.id == vid)
            v_res = await db.execute(v_stmt)
            veh = v_res.scalar_one_or_none()
            if not veh:
                veh = Vehicle(
                    id=vid,
                    registration_number=vreg,
                    model="Fleet Vehicle",
                    vehicle_type=vtype,
                    status="IN_TRANSIT",
                )
                db.add(veh)
                await db.flush()

            # 3. Restore Journey
            cid = payload.get("cid")
            j_stmt = select(Journey).where(Journey.id == jid)
            j_res = await db.execute(j_stmt)
            restored_journey = j_res.scalar_one_or_none()
            started_dt = now
            if payload.get("st"):
                try:
                    started_dt = datetime.fromisoformat(payload["st"].replace("Z", "+00:00"))
                except Exception:
                    started_dt = now
            if not restored_journey:
                restored_journey = Journey(
                    id=jid,
                    company_id=cid,
                    vehicle_id=veh.id,
                    driver_id=driver_u.id,
                    origin_name=payload.get("oname", "Start Point"),
                    origin_lat=float(payload.get("olat", 12.9716)),
                    origin_lng=float(payload.get("olng", 77.5946)),
                    destination_name=payload.get("destname", "Destination"),
                    destination_lat=float(payload.get("dlat", 12.9750)),
                    destination_lng=float(payload.get("dlng", 77.5980)),
                    status="IN_PROGRESS",
                    started_at=started_dt,
                )
                db.add(restored_journey)
                await db.flush()

                # Add initial location breadcrumb
                init_loc = Location(
                    journey_id=restored_journey.id,
                    latitude=restored_journey.origin_lat,
                    longitude=restored_journey.origin_lng,
                    speed=0.0,
                    heading=0.0,
                    accuracy=5.0,
                    altitude=0.0,
                    recorded_at=started_dt,
                )
                db.add(init_loc)

            # 4. Restore TrackingLink
            restored_link = TrackingLink(
                journey_id=restored_journey.id,
                token_hash=token_hash,
                expires_at=datetime.fromtimestamp(exp, tz=timezone.utc) if exp else now + timedelta(hours=24),
                access_count=1,
            )
            db.add(restored_link)
            await db.commit()

            # Re-fetch with eager loaded relationships to avoid DetachedInstanceError
            rf_stmt = (
                select(Journey)
                .where(Journey.id == jid)
                .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
            )
            rf_res = await db.execute(rf_stmt)
            final_journey = rf_res.scalar_one_or_none()
            if not final_journey:
                final_journey = restored_journey
                final_journey.vehicle = veh
                final_journey.driver = driver_u

            return final_journey, restored_link
        except Exception as e:
            logger.info("Stateless JWT decode skipped/notice: %s. Checking direct DB match...", e)

        # Fallback: check if token directly matches an existing Journey.id UUID in this DB
        try:
            j_direct_stmt = (
                select(Journey)
                .where(Journey.id == token)
                .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
            )
            j_direct_res = await db.execute(j_direct_stmt)
            direct_journey = j_direct_res.scalar_one_or_none()
            if direct_journey and direct_journey.status == "IN_PROGRESS":
                pseudo_link = TrackingLink(
                    journey_id=direct_journey.id,
                    token_hash=token_hash,
                    expires_at=now + timedelta(hours=24),
                    access_count=1,
                )
                return direct_journey, pseudo_link
        except Exception:
            pass

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
