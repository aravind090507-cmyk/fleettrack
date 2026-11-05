"""Corporate Fleet Management Dashboard Analytics and State Aggregator."""
from __future__ import annotations

import logging
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.session import get_db
from app.models.journey import Journey
from app.models.location import Location
from app.models.trip_event import TripEvent
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.dashboard import ActiveJourneyResponse, ActiveVehicleResponse, OverviewResponse, TripAlertResponse
from app.schemas.location import LocationPing
from app.security.dependencies import require_fleet_manager
from app.services.redis_service import get_redis_service

logger = logging.getLogger("fleettrack.dashboard")
router = APIRouter(prefix="/api/dashboard", tags=["Company Dashboard"])


@router.get("/overview", response_model=OverviewResponse)
async def get_fleet_overview(
    current_user: User = Depends(require_fleet_manager),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate high-level operational fleet metrics."""
    # 1. Total vehicles
    v_res = await db.execute(select(func.count(Vehicle.id)))
    total_vehicles = v_res.scalar_one()

    # 2. In transit
    it_res = await db.execute(select(func.count(Vehicle.id)).where(Vehicle.status == "IN_TRANSIT"))
    in_transit = it_res.scalar_one()

    # 3. Offline vehicles
    off_res = await db.execute(select(func.count(Vehicle.id)).where(Vehicle.status == "OFFLINE"))
    offline_vehicles = off_res.scalar_one()

    # 4. Active journeys
    aj_res = await db.execute(select(func.count(Journey.id)).where(Journey.status == "IN_PROGRESS"))
    active_journeys = aj_res.scalar_one()

    # 5. Completed journeys
    cj_res = await db.execute(select(func.count(Journey.id)).where(Journey.status == "COMPLETED"))
    completed_journeys = cj_res.scalar_one()

    # 6. Active SOS alerts (within last 2 hours)
    sos_res = await db.execute(select(func.count(TripEvent.id)).where(TripEvent.event_type == "SOS"))
    active_sos = sos_res.scalar_one()

    return OverviewResponse(
        total_vehicles=total_vehicles,
        active_journeys=active_journeys,
        completed_journeys=completed_journeys,
        offline_vehicles=offline_vehicles,
        in_transit=in_transit,
        active_sos_alerts=active_sos,
    )


@router.get("/active-vehicles", response_model=List[ActiveVehicleResponse])
async def get_active_vehicles_with_telemetry(
    current_user: User = Depends(require_fleet_manager),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all corporate vehicles combined with their latest real-time GPS coordinates."""
    stmt = (
        select(Vehicle)
        .options(
            selectinload(Vehicle.assigned_driver),
            selectinload(Vehicle.journeys),
        )
        .order_by(Vehicle.registration_number.asc())
    )
    result = await db.execute(stmt)
    vehicles = result.scalars().all()

    redis_svc = get_redis_service()
    output = []

    for v in vehicles:
        # Find active journey if any
        active_j = next((j for j in v.journeys if j.status == "IN_PROGRESS"), None)
        active_j_id = active_j.id if active_j else None

        # Check Redis for live position
        latest_cache = await redis_svc.get_latest_vehicle_location(v.id)

        lat = None
        lng = None
        speed = None
        heading = None
        rec_at = None

        if latest_cache:
            from datetime import datetime
            lat = latest_cache.get("latitude")
            lng = latest_cache.get("longitude")
            speed = latest_cache.get("speed")
            heading = latest_cache.get("heading")
            if latest_cache.get("timestamp"):
                rec_at = datetime.fromisoformat(latest_cache["timestamp"])
        elif active_j:
            # Fallback to database latest location
            loc_stmt = (
                select(Location)
                .where(Location.journey_id == active_j.id)
                .order_by(Location.recorded_at.desc())
                .limit(1)
            )
            loc_res = await db.execute(loc_stmt)
            loc = loc_res.scalar_one_or_none()
            if loc:
                lat = loc.latitude
                lng = loc.longitude
                speed = loc.speed
                heading = loc.heading
                rec_at = loc.recorded_at
            else:
                # Fallback to origin coordinates when journey just started and 0 pings yet
                lat = active_j.origin_lat
                lng = active_j.origin_lng
                speed = 0.0
                heading = 0.0
                rec_at = active_j.started_at

        output.append(
            ActiveVehicleResponse(
                vehicle_id=v.id,
                registration_number=v.registration_number,
                model=v.model,
                vehicle_type=v.vehicle_type,
                status=v.status,
                assigned_driver_id=v.assigned_driver_id,
                assigned_driver_name=v.assigned_driver.name if v.assigned_driver else None,
                current_journey_id=active_j_id,
                latest_latitude=lat,
                latest_longitude=lng,
                latest_speed=speed,
                latest_heading=heading,
                latest_recorded_at=rec_at,
            )
        )

    return output


@router.get("/active-journeys", response_model=List[ActiveJourneyResponse])
async def get_active_journeys_dashboard(
    current_user: User = Depends(require_fleet_manager),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all active dispatches with vehicle, driver, live coordinates, and latest status event."""
    stmt = (
        select(Journey)
        .where(Journey.status == "IN_PROGRESS")
        .options(
            selectinload(Journey.vehicle),
            selectinload(Journey.driver),
            selectinload(Journey.locations),
            selectinload(Journey.trip_events),
        )
        .order_by(Journey.started_at.desc())
    )
    result = await db.execute(stmt)
    journeys = result.scalars().all()

    output = []
    for j in journeys:
        latest_loc = j.locations[-1] if j.locations else None
        latest_ping_dto = None
        if latest_loc:
            latest_ping_dto = LocationPing(
                latitude=latest_loc.latitude,
                longitude=latest_loc.longitude,
                speed=latest_loc.speed,
                heading=latest_loc.heading,
                accuracy=latest_loc.accuracy,
                altitude=latest_loc.altitude,
                timestamp=latest_loc.recorded_at,
            )
        else:
            latest_ping_dto = LocationPing(
                latitude=j.origin_lat,
                longitude=j.origin_lng,
                speed=0.0,
                heading=0.0,
                accuracy=0.0,
                altitude=0.0,
                timestamp=j.started_at,
            )

        latest_event = j.trip_events[-1] if j.trip_events else None

        output.append(
            ActiveJourneyResponse(
                journey_id=j.id,
                vehicle_id=j.vehicle_id,
                vehicle_registration=j.vehicle.registration_number if j.vehicle else "UNKNOWN",
                driver_id=j.driver_id,
                driver_name=j.driver.name if j.driver else "Driver",
                origin_name=j.origin_name,
                origin_lat=j.origin_lat,
                origin_lng=j.origin_lng,
                destination_name=j.destination_name,
                destination_lat=j.destination_lat,
                destination_lng=j.destination_lng,
                status=j.status,
                started_at=j.started_at,
                duration_seconds=j.duration_seconds,
                total_distance_km=j.total_distance_km,
                latest_location=latest_ping_dto,
                latest_event_type=latest_event.event_type if latest_event else None,
                latest_event_at=latest_event.created_at if latest_event else None,
            )
        )

    return output


@router.get("/events", response_model=List[TripAlertResponse])
async def get_recent_fleet_events(
    limit: int = 20,
    current_user: User = Depends(require_fleet_manager),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve recent fleet incidents (SOS, BREAKDOWN, BREAK_START, etc.)."""
    stmt = (
        select(TripEvent)
        .options(
            selectinload(TripEvent.journey).selectinload(Journey.vehicle),
            selectinload(TripEvent.journey).selectinload(Journey.driver),
        )
        .order_by(TripEvent.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    events = result.scalars().all()

    output = []
    for ev in events:
        v_reg = None
        d_name = None
        if ev.journey:
            if ev.journey.vehicle:
                v_reg = ev.journey.vehicle.registration_number
            if ev.journey.driver:
                d_name = ev.journey.driver.name

        output.append(
            TripAlertResponse(
                id=ev.id,
                journey_id=ev.journey_id,
                vehicle_registration=v_reg,
                driver_name=d_name,
                event_type=ev.event_type,
                latitude=ev.latitude,
                longitude=ev.longitude,
                metadata_json=ev.metadata_json or {},
                created_at=ev.created_at,
            )
        )

    return output
