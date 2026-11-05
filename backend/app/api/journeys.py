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
    # 1. Verify vehicle exists and is available
    stmt = select(Vehicle).where(Vehicle.id == payload.vehicle_id)
    result = await db.execute(stmt)
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    if vehicle.status == "IN_TRANSIT":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vehicle {vehicle.registration_number} is already in transit on another journey",
        )

    # 2. Check if driver already has an active journey
    active_stmt = (
        select(Journey)
        .where(Journey.driver_id == current_user.id, Journey.status == "IN_PROGRESS")
    )
    active_result = await db.execute(active_stmt)
    existing_active = active_result.scalar_one_or_none()
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Driver already has an active journey in progress. Please complete it first.",
        )

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
    for j in journeys:
        resp = JourneyResponse.model_validate(j)
        if j.vehicle:
            resp.vehicle_registration = j.vehicle.registration_number
        if j.driver:
            resp.driver_name = j.driver.name
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
    for j in journeys:
        resp = JourneyResponse.model_validate(j)
        if j.vehicle:
            resp.vehicle_registration = j.vehicle.registration_number
        if j.driver:
            resp.driver_name = j.driver.name
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
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    # Only assigned driver or fleet manager can end
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot end another driver's journey")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

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
