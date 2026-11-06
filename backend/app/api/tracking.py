"""
Public Ephemeral Tracking Link Resolver.
Provides read-only journey access to external viewers and company dispatchers.
Returns HTTP 410 Gone immediately when a journey is concluded or expired.
"""
from __future__ import annotations

import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.location import Location
from app.schemas.tracking import LatestLocation, TrackingInfoResponse, TrackingLocationResponse
from app.services.journey_service import validate_tracking_token
from app.services.redis_service import get_redis_service

logger = logging.getLogger("fleettrack.tracking")
router = APIRouter(prefix="/api/track", tags=["Public Tracking Links"])


@router.get("/{token}", response_model=TrackingInfoResponse)
async def get_public_tracking_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve a temporary journey tracking link.
    If the journey is active: returns minimum-necessary operational data.
    If revoked or expired: returns HTTP 410 Gone.
    """
    redis_svc = get_redis_service()
    validation_res = await validate_tracking_token(db=db, token=token, redis_svc=redis_svc)

    if not validation_res:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="THIS JOURNEY HAS ENDED. Tracking access is no longer available.",
        )

    journey, _ = validation_res

    # Retrieve latest location coordinates
    latest_stmt = (
        select(Location)
        .where(Location.journey_id == journey.id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )
    latest_res = await db.execute(latest_stmt)
    latest_loc = latest_res.scalar_one_or_none()

    latest_loc_dto = None
    if latest_loc:
        latest_loc_dto = LatestLocation(
            latitude=latest_loc.latitude,
            longitude=latest_loc.longitude,
            speed=latest_loc.speed,
            heading=latest_loc.heading,
            accuracy=latest_loc.accuracy,
            recorded_at=latest_loc.recorded_at,
        )
    else:
        latest_loc_dto = LatestLocation(
            latitude=journey.origin_lat,
            longitude=journey.origin_lng,
            speed=0.0,
            heading=0.0,
            accuracy=5.0,
            recorded_at=journey.started_at,
        )

    veh_reg = getattr(journey.vehicle, "registration_number", "FLEET-01") if journey.vehicle else "FLEET-01"
    veh_type = getattr(journey.vehicle, "vehicle_type", "VAN") if journey.vehicle else "VAN"
    drv_name = getattr(journey.driver, "name", "Assigned Driver") if journey.driver else "Assigned Driver"

    # --- ETA Computation ---
    eta_minutes = None
    distance_remaining_km = None
    if latest_loc and journey.destination_lat and journey.destination_lng:
        import math
        lat1 = math.radians(latest_loc.latitude)
        lat2 = math.radians(journey.destination_lat)
        dlat = math.radians(journey.destination_lat - latest_loc.latitude)
        dlng = math.radians(journey.destination_lng - latest_loc.longitude)
        a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
        dist_km = 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        distance_remaining_km = round(dist_km, 2)
        avg_speed_kmh = latest_loc.speed if latest_loc.speed and latest_loc.speed > 2 else 30.0
        if avg_speed_kmh > 0:
            eta_minutes = round((dist_km / avg_speed_kmh) * 60, 1)

    # --- Latest Trip Event ---
    from app.models.trip_event import TripEvent
    evt_stmt = (
        select(TripEvent)
        .where(TripEvent.journey_id == journey.id)
        .order_by(TripEvent.created_at.desc())
        .limit(1)
    )
    evt_res = await db.execute(evt_stmt)
    latest_event = evt_res.scalar_one_or_none()

    return TrackingInfoResponse(
        journey_id=journey.id,
        vehicle_id=journey.vehicle_id,
        vehicle_registration=veh_reg,
        vehicle_type=veh_type,
        driver_id=journey.driver_id,
        driver_name=drv_name,
        origin_name=journey.origin_name,
        destination_name=journey.destination_name,
        origin_lat=journey.origin_lat,
        origin_lng=journey.origin_lng,
        destination_lat=journey.destination_lat,
        destination_lng=journey.destination_lng,
        status=journey.status,
        started_at=journey.started_at,
        latest_location=latest_loc_dto,
        eta_minutes=eta_minutes,
        distance_remaining_km=distance_remaining_km,
        latest_event_type=latest_event.event_type if latest_event else None,
        latest_event_at=latest_event.created_at if latest_event else None,
        latest_event_note=latest_event.notes if latest_event else None,
    )


@router.get("/{token}/location", response_model=TrackingLocationResponse)
async def get_public_tracking_location(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Poll latest position for clients unable to maintain a WebSocket connection."""
    redis_svc = get_redis_service()
    validation_res = await validate_tracking_token(db=db, token=token, redis_svc=redis_svc)

    if not validation_res:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="THIS JOURNEY HAS ENDED. Tracking access is no longer available.",
        )

    journey, _ = validation_res

    # Fast path: check Redis latest cache
    redis_latest = await redis_svc.get_latest_vehicle_location(journey.vehicle_id)
    if redis_latest:
        from datetime import datetime
        latest_dto = LatestLocation(
            latitude=redis_latest["latitude"],
            longitude=redis_latest["longitude"],
            speed=redis_latest["speed"],
            heading=redis_latest["heading"],
            accuracy=0.0,
            recorded_at=datetime.fromisoformat(redis_latest["timestamp"]),
        )
        return TrackingLocationResponse(
            journey_id=journey.id,
            status=journey.status,
            latest_location=latest_dto,
            is_active=True,
        )

    # Database fallback
    latest_stmt = (
        select(Location)
        .where(Location.journey_id == journey.id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )
    latest_res = await db.execute(latest_stmt)
    latest_loc = latest_res.scalar_one_or_none()

    latest_loc_dto = None
    if latest_loc:
        latest_loc_dto = LatestLocation(
            latitude=latest_loc.latitude,
            longitude=latest_loc.longitude,
            speed=latest_loc.speed,
            heading=latest_loc.heading,
            accuracy=latest_loc.accuracy,
            recorded_at=latest_loc.recorded_at,
        )
    else:
        latest_loc_dto = LatestLocation(
            latitude=journey.origin_lat,
            longitude=journey.origin_lng,
            speed=0.0,
            heading=0.0,
            accuracy=5.0,
            recorded_at=journey.started_at,
        )

    return TrackingLocationResponse(
        journey_id=journey.id,
        status=journey.status,
        latest_location=latest_loc_dto,
        is_active=True,
    )


@router.get("/{token}/trail", response_model=List[LatestLocation])
async def get_public_tracking_trail(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve full breadcrumb trail for public tracking map."""
    redis_svc = get_redis_service()
    validation_res = await validate_tracking_token(db=db, token=token, redis_svc=redis_svc)

    if not validation_res:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="THIS JOURNEY HAS ENDED. Tracking access is no longer available.",
        )

    journey, _ = validation_res

    stmt = (
        select(Location)
        .where(Location.journey_id == journey.id)
        .order_by(Location.recorded_at.asc())
        .limit(2000)
    )
    res = await db.execute(stmt)
    locations = res.scalars().all()

    if not locations:
        return [
            LatestLocation(
                latitude=journey.origin_lat,
                longitude=journey.origin_lng,
                speed=0.0,
                heading=0.0,
                accuracy=5.0,
                recorded_at=journey.started_at,
            )
        ]

    return [
        LatestLocation(
            latitude=loc.latitude,
            longitude=loc.longitude,
            speed=loc.speed,
            heading=loc.heading,
            accuracy=loc.accuracy,
            recorded_at=loc.recorded_at,
        )
        for loc in locations
    ]
