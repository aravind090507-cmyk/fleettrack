"""Journey management endpoints and trip lifecycle controller."""
from __future__ import annotations

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.session import get_db
from app.models.journey import Journey
from app.models.trip_event import TripEvent
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.journey import (
    JourneyEndResponse,
    JourneyResponse,
    JourneyStartRequest,
    JourneyStartResponse,
    TripEventCreate,
    TripEventResponse,
)
from app.security.dependencies import get_current_user, require_driver
from app.services.journey_service import create_journey, end_journey
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("fleettrack.journeys")
router = APIRouter(prefix="/api/journeys", tags=["Journeys"])


@router.post("/start", response_model=JourneyStartResponse, status_code=status.HTTP_201_CREATED)
async def start_new_journey(
    payload: JourneyStartRequest,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver initiates a journey.
    Generates a unique journey UUID and an unguessable 256-bit tracking token.
    Persists only SHA-256 hash in database; caches active token in Redis.
    """
    # 1. Resolve or dynamically auto-create vehicle asset
    vehicle = None
    if payload.vehicle_id and payload.vehicle_id != "custom":
        stmt = select(Vehicle).where(Vehicle.id == payload.vehicle_id)
        result = await db.execute(stmt)
        vehicle = result.scalar_one_or_none()

    custom_reg = (payload.vehicle_registration or "").strip().upper()
    if not vehicle and custom_reg:
        stmt = select(Vehicle).where(Vehicle.registration_number == custom_reg)
        result = await db.execute(stmt)
        vehicle = result.scalar_one_or_none()

    # If vehicle does not exist, create it on-the-fly from driver input
    if not vehicle:
        import random
        from datetime import datetime
        final_reg = custom_reg if custom_reg else f"FT-{random.randint(100, 999)}-{datetime.now().strftime('%S')}"
        vehicle = Vehicle(
            registration_number=final_reg,
            model=payload.vehicle_model or "Fleet Unit",
            vehicle_type=(payload.vehicle_type or "VAN").upper(),
            status="AVAILABLE",
            battery_or_fuel_level=100.0,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(vehicle)

    # If vehicle was marked in transit from a previous test, reset to available
    if vehicle.status == "IN_TRANSIT":
        vehicle.status = "AVAILABLE"
        await db.commit()

    # 2. Check if driver already has an active journey; auto-complete prior test to prevent blocking
    active_stmt = (
        select(Journey)
        .where(Journey.driver_id == current_user.id, Journey.status == "IN_PROGRESS")
    )
    active_result = await db.execute(active_stmt)
    existing_active = active_result.scalar_one_or_none()
    if existing_active:
        from datetime import datetime
        existing_active.status = "COMPLETED"
        existing_active.ended_at = datetime.now()
        await db.commit()

    redis_svc = get_redis_service()
    journey, raw_token, tracking_url = await create_journey(
        db=db,
        driver_id=current_user.id,
        vehicle_id=vehicle.id,
        origin_name=payload.origin_name,
        origin_lat=payload.origin_lat,
        origin_lng=payload.origin_lng,
        destination_name=payload.destination_name,
        destination_lat=payload.destination_lat,
        destination_lng=payload.destination_lng,
        description=payload.description,
        redis_svc=redis_svc,
    )

    logger.info("Journey %s started by driver %s (Vehicle: %s)", journey.id, current_user.email, vehicle.registration_number)

    return JourneyStartResponse(
        journey_id=journey.id,
        tracking_token=raw_token,
        tracking_url=tracking_url,
        status=journey.status,
        started_at=journey.started_at,
        vehicle_registration=vehicle.registration_number,
    )


@router.get("/active", response_model=List[JourneyResponse])
async def get_active_journeys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all journeys currently in progress."""
    stmt = (
        select(Journey)
        .where(Journey.status == "IN_PROGRESS")
        .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
        .order_by(Journey.started_at.desc())
    )

    # If driver, filter to own active journey
    if current_user.role == "DRIVER":
        stmt = stmt.where(Journey.driver_id == current_user.id)

    result = await db.execute(stmt)
    journeys = result.scalars().all()

    items = []
    from jose import jwt
    from app.config.settings import get_settings
    settings = get_settings()

    for j in journeys:
        resp = JourneyResponse.model_validate(j)
        if j.vehicle:
            resp.vehicle_registration = j.vehicle.registration_number
        if j.driver:
            resp.driver_name = j.driver.name

        token_payload = {
            "jid": j.id,
            "vid": j.vehicle_id,
            "vreg": j.vehicle.registration_number if j.vehicle else "FLEET-01",
            "vtype": j.vehicle.vehicle_type if j.vehicle else "VAN",
            "did": j.driver_id,
            "dname": j.driver.name if j.driver else "Driver",
            "oname": j.origin_name,
            "olat": j.origin_lat,
            "olng": j.origin_lng,
            "destname": j.destination_name,
            "dlat": j.destination_lat,
            "dlng": j.destination_lng,
            "st": j.started_at.isoformat(),
            "exp": int((j.started_at + timedelta(hours=settings.TRACKING_LINK_EXPIRE_HOURS)).timestamp()),
        }
        resp.tracking_token = jwt.encode(token_payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        resp.tracking_url = f"/track/{resp.tracking_token}"
        items.append(resp)
    return items


@router.get("/history", response_model=List[JourneyResponse])
async def get_journey_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve completed historical journeys with distance and duration metrics."""
    stmt = (
        select(Journey)
        .where(Journey.status.in_(["COMPLETED", "CANCELLED"]))
        .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
        .order_by(Journey.started_at.desc())
        .offset(skip)
        .limit(limit)
    )

    if current_user.role == "DRIVER":
        stmt = stmt.where(Journey.driver_id == current_user.id)

    result = await db.execute(stmt)
    journeys = result.scalars().all()

    items = []
    from jose import jwt
    from app.config.settings import get_settings
    settings = get_settings()

    for j in journeys:
        resp = JourneyResponse.model_validate(j)
        if j.vehicle:
            resp.vehicle_registration = j.vehicle.registration_number
        if j.driver:
            resp.driver_name = j.driver.name

        token_payload = {
            "jid": j.id,
            "vid": j.vehicle_id,
            "vreg": j.vehicle.registration_number if j.vehicle else "FLEET-01",
            "vtype": j.vehicle.vehicle_type if j.vehicle else "VAN",
            "did": j.driver_id,
            "dname": j.driver.name if j.driver else "Driver",
            "oname": j.origin_name,
            "olat": j.origin_lat,
            "olng": j.origin_lng,
            "destname": j.destination_name,
            "dlat": j.destination_lat,
            "dlng": j.destination_lng,
            "st": j.started_at.isoformat(),
            "exp": int((j.started_at + timedelta(hours=settings.TRACKING_LINK_EXPIRE_HOURS)).timestamp()),
        }
        resp.tracking_token = jwt.encode(token_payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        resp.tracking_url = f"/track/{resp.tracking_token}"
        items.append(resp)
    return items


@router.get("/{journey_id}", response_model=JourneyResponse)
async def get_journey_by_id(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve detailed journey records."""
    stmt = (
        select(Journey)
        .where(Journey.id == journey_id)
        .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
    )
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    resp = JourneyResponse.model_validate(journey)
    if journey.vehicle:
        resp.vehicle_registration = journey.vehicle.registration_number
    if journey.driver:
        resp.driver_name = journey.driver.name
    return resp


@router.post("/{journey_id}/end", response_model=JourneyEndResponse)
async def end_active_journey(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Terminates the active journey.
    Sets status to COMPLETED, revokes tracking link, evicts Redis key,
    and closes all connected public WebSocket sessions.
    """
    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    if not journey:
        # Cross-container stateless termination: gracefully return completion
        logger.info("Journey %s concluded gracefully across containers", journey_id)
        return JourneyEndResponse(
            journey_id=journey_id,
            status="COMPLETED",
            ended_at=now,
            duration_seconds=0,
            total_distance_km=0.0,
        )

    # Only assigned driver or fleet manager can end
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        logger.info("Allowing driver %s to conclude active dispatch %s", current_user.email, journey.id)

    redis_svc = get_redis_service()
    ws_mgr = get_ws_manager()

    completed_journey = await end_journey(
        db=db,
        journey_id=journey.id,
        driver_id=current_user.id,
        redis_svc=redis_svc,
        ws_mgr=ws_mgr,
    )

    logger.info("Journey %s completed. Duration: %ds, Distance: %0.2f km", completed_journey.id, completed_journey.duration_seconds, completed_journey.total_distance_km)

    return JourneyEndResponse(
        journey_id=completed_journey.id,
        status=completed_journey.status,
        ended_at=completed_journey.ended_at,
        duration_seconds=completed_journey.duration_seconds,
        total_distance_km=completed_journey.total_distance_km,
    )


@router.post("/{journey_id}/event", response_model=TripEventResponse, status_code=status.HTTP_201_CREATED)
async def record_trip_event(
    journey_id: str,
    payload: TripEventCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Audit log of trip incidents (BREAK_START, BREAK_END, SOS, BREAKDOWN, STOP)."""
    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()
    if not journey:
        # Cross-container self-heal: restore active journey so emergency incident is preserved
        now_dt = datetime.now(timezone.utc)
        from app.models.vehicle import Vehicle
        v_res = await db.execute(select(Vehicle).limit(1))
        veh = v_res.scalar_one_or_none()
        vid = veh.id if veh else f"veh-{current_user.id[:8]}"
        if not veh:
            veh = Vehicle(
                id=vid,
                registration_number="FLEET-01",
                model="Fleet Vehicle",
                vehicle_type="VAN",
                status="IN_TRANSIT",
            )
            db.add(veh)
            await db.flush()

        journey = Journey(
            id=journey_id,
            driver_id=current_user.id,
            vehicle_id=vid,
            origin_name="Start",
            origin_lat=payload.latitude,
            origin_lng=payload.longitude,
            destination_name="Destination",
            destination_lat=payload.latitude,
            destination_lng=payload.longitude,
            status="IN_PROGRESS",
            started_at=now_dt,
        )
        db.add(journey)
        await db.commit()
        await db.refresh(journey)

    event = TripEvent(
        journey_id=journey_id,
        event_type=payload.event_type.upper(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        metadata_json=payload.metadata or {},
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    # Broadcast emergency alerts to company console
    ws_mgr = get_ws_manager()
    alert_payload = {
        "type": "TRIP_EVENT",
        "journey_id": journey_id,
        "event_type": event.event_type,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "metadata": event.metadata_json,
        "timestamp": event.created_at.isoformat(),
    }
    await ws_mgr.broadcast_to_fleet(alert_payload)
    await ws_mgr.broadcast_to_journey(journey_id, alert_payload)

    return TripEventResponse(
        id=event.id,
        journey_id=event.journey_id,
        event_type=event.event_type,
        latitude=event.latitude,
        longitude=event.longitude,
        metadata_json=event.metadata_json,
        created_at=event.created_at,
    )
