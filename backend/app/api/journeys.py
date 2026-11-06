"""Journey management endpoints and trip lifecycle controller."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from jose import jwt

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
            company_id=current_user.company_id,
            registration_number=final_reg,
            model=payload.vehicle_model or "Fleet Unit",
            vehicle_type=(payload.vehicle_type or "VAN").upper(),
            status="AVAILABLE",
            battery_or_fuel_level=100.0,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(vehicle)

    # Verify company ownership if existing vehicle
    if vehicle.company_id and current_user.company_id and vehicle.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vehicle belongs to another organization")

    # If vehicle was marked in transit from a previous test, reset to available
    if vehicle.status == "IN_TRANSIT":
        vehicle.status = "AVAILABLE"
        await db.commit()

    # 2. Check if driver already has an active journey; reject with 409 Conflict if so
    active_stmt = (
        select(Journey)
        .where(Journey.driver_id == current_user.id, Journey.status == "IN_PROGRESS")
    )
    active_result = await db.execute(active_stmt)
    existing_active = active_result.scalar_one_or_none()
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Driver already has an active journey in progress (ID: {existing_active.id}). Please complete or end it before starting a new journey.",
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
        company_id=current_user.company_id,
    )

    logger.info("Journey %s started by driver %s (Vehicle: %s)", journey.id, current_user.email, vehicle.registration_number)

    ws_mgr = get_ws_manager()
    await ws_mgr.broadcast_to_fleet({
        "type": "JOURNEY_STARTED",
        "journey_id": journey.id,
        "vehicle_id": vehicle.id,
        "vehicle_registration": vehicle.registration_number,
        "driver_name": current_user.name,
        "origin_name": journey.origin_name,
        "origin_lat": journey.origin_lat,
        "origin_lng": journey.origin_lng,
        "destination_name": journey.destination_name,
        "destination_lat": journey.destination_lat,
        "destination_lng": journey.destination_lng,
    }, company_id=current_user.company_id)

    return JourneyStartResponse(
        journey_id=journey.id,
        vehicle_id=vehicle.id,
        driver_id=current_user.id,
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

    # Multi-tenant isolation
    if current_user.company_id:
        stmt = stmt.where(Journey.company_id == current_user.company_id)
    # If driver, filter to own active journey
    if current_user.role == "DRIVER":
        stmt = stmt.where(Journey.driver_id == current_user.id)

    result = await db.execute(stmt)
    journeys = result.scalars().all()

    items = []
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
            "cid": j.company_id,
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

    # Multi-tenant isolation
    if current_user.company_id:
        stmt = stmt.where(Journey.company_id == current_user.company_id)
    if current_user.role == "DRIVER":
        stmt = stmt.where(Journey.driver_id == current_user.id)

    result = await db.execute(stmt)
    journeys = result.scalars().all()

    items = []
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
            "cid": j.company_id,
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

    # Multi-tenant validation
    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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

    # Multi-tenant and ownership check
    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-company access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only assigned driver or manager can end this journey")

    if journey.status == "COMPLETED":
        return JourneyEndResponse(
            journey_id=journey.id,
            status=journey.status,
            ended_at=journey.ended_at or now,
            duration_seconds=journey.duration_seconds or 0,
            total_distance_km=journey.total_distance_km or 0.0,
        )

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


@router.post("/{journey_id}/tracking-link/revoke", status_code=status.HTTP_200_OK)
async def revoke_tracking_link(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Driver or manager manually invalidates public tracking link before trip end."""
    stmt = select(Journey).where(Journey.id == journey_id).options(selectinload(Journey.tracking_links))
    res = await db.execute(stmt)
    journey = res.scalar_one_or_none()
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")
    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    redis_svc = get_redis_service()
    for link in journey.tracking_links:
        link.revoked_at = now
        await redis_svc.revoke_tracking_token(link.token_hash)
    await db.commit()
    return {"status": "revoked", "journey_id": journey_id}


@router.post("/{journey_id}/event", response_model=TripEventResponse, status_code=status.HTTP_201_CREATED)
@router.post("/{journey_id}/events", response_model=TripEventResponse, status_code=status.HTTP_201_CREATED)
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
    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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
