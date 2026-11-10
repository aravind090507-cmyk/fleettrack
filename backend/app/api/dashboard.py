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
    cid = current_user.company_id

    # 1. Total vehicles
    v_stmt = select(func.count(Vehicle.id))
    if cid:
        v_stmt = v_stmt.where(Vehicle.company_id == cid)
    v_res = await db.execute(v_stmt)
    total_vehicles = v_res.scalar_one()

    # 2. In transit
    it_stmt = select(func.count(Vehicle.id)).where(Vehicle.status == "IN_TRANSIT")
    if cid:
        it_stmt = it_stmt.where(Vehicle.company_id == cid)
    it_res = await db.execute(it_stmt)
    in_transit = it_res.scalar_one()

    # 3. Offline vehicles
    off_stmt = select(func.count(Vehicle.id)).where(Vehicle.status == "OFFLINE")
    if cid:
        off_stmt = off_stmt.where(Vehicle.company_id == cid)
    off_res = await db.execute(off_stmt)
    offline_vehicles = off_res.scalar_one()

    # 4. Active journeys
    aj_stmt = select(func.count(Journey.id)).where(Journey.status == "IN_PROGRESS")
    if cid:
        aj_stmt = aj_stmt.where(Journey.company_id == cid)
    aj_res = await db.execute(aj_stmt)
    active_journeys = aj_res.scalar_one()

    # 5. Completed journeys
    cj_stmt = select(func.count(Journey.id)).where(Journey.status == "COMPLETED")
    if cid:
        cj_stmt = cj_stmt.where(Journey.company_id == cid)
    cj_res = await db.execute(cj_stmt)
    completed_journeys = cj_res.scalar_one()

    # 6. Active SOS alerts (scoped by company)
    sos_stmt = select(func.count(TripEvent.id)).join(Journey, TripEvent.journey_id == Journey.id).where(TripEvent.event_type == "SOS")
    if cid:
        sos_stmt = sos_stmt.where(Journey.company_id == cid)
    sos_res = await db.execute(sos_stmt)
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
            selectinload(Vehicle.journeys).selectinload(Journey.trip_events),
        )
        .order_by(Vehicle.registration_number.asc())
    )
    if current_user.company_id:
        stmt = stmt.where(Vehicle.company_id == current_user.company_id)
    result = await db.execute(stmt)
    vehicles = result.scalars().all()

    # Bulk fetch latest location for active journeys in a single set-based query
    active_j_map = {v.id: next((j for j in v.journeys if j.status == "IN_PROGRESS"), None) for v in vehicles}
    active_j_ids = [j.id for j in active_j_map.values() if j]

    latest_loc_by_journey = {}
    if active_j_ids:
        subq = (
            select(Location.journey_id, func.max(Location.recorded_at).label("max_rec"))
            .where(Location.journey_id.in_(active_j_ids))
            .group_by(Location.journey_id)
            .subquery()
        )
        stmt_bulk = (
            select(Location)
            .join(subq, (Location.journey_id == subq.c.journey_id) & (Location.recorded_at == subq.c.max_rec))
        )
        bulk_locs = (await db.execute(stmt_bulk)).scalars().all()
        for loc in bulk_locs:
            latest_loc_by_journey[loc.journey_id] = loc

    redis_svc = get_redis_service()
    output = []

    for v in vehicles:
        active_j = active_j_map.get(v.id)
        active_j_id = active_j.id if active_j else None

        # Check Redis for live position
        latest_cache = await redis_svc.get_latest_vehicle_location(v.id)

        lat = None
        lng = None
        speed = None
        heading = None
        rec_at = None

        if active_j:
            if latest_cache:
                from datetime import datetime
                lat = latest_cache.get("latitude")
                lng = latest_cache.get("longitude")
                speed = latest_cache.get("speed")
                heading = latest_cache.get("heading")
                if latest_cache.get("timestamp"):
                    rec_at = datetime.fromisoformat(latest_cache["timestamp"])
            else:
                loc = latest_loc_by_journey.get(active_j.id)
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
        else:
            # Vehicle is available/stationary: no active journey
            speed = 0.0
            heading = 0.0
            if latest_cache:
                from datetime import datetime
                lat = latest_cache.get("latitude")
                lng = latest_cache.get("longitude")
                if latest_cache.get("timestamp"):
                    rec_at = datetime.fromisoformat(latest_cache["timestamp"])

        # Resolve latest event for vehicle (SOS, BREAKDOWN, BREAK_START)
        latest_ev_type = None
        if active_j and active_j.trip_events:
            sorted_evs = sorted(active_j.trip_events, key=lambda e: e.created_at)
            latest_ev_type = sorted_evs[-1].event_type

        # If vehicle has no active journey or Redis cache, resolve its most recent historical location
        if lat is None and lng is None:
            last_loc_stmt = (
                select(Location)
                .join(Journey, Location.journey_id == Journey.id)
                .where(Journey.vehicle_id == v.id)
                .order_by(Location.recorded_at.desc())
                .limit(1)
            )
            last_loc_res = await db.execute(last_loc_stmt)
            last_loc = last_loc_res.scalar_one_or_none()
            if last_loc:
                lat = last_loc.latitude
                lng = last_loc.longitude
                speed = 0.0
                heading = last_loc.heading or 0.0
                rec_at = last_loc.recorded_at

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
                latest_event_type=latest_ev_type,
                origin_name=active_j.origin_name if active_j else None,
                origin_lat=active_j.origin_lat if active_j else None,
                origin_lng=active_j.origin_lng if active_j else None,
                destination_name=active_j.destination_name if active_j else None,
                destination_lat=active_j.destination_lat if active_j else None,
                destination_lng=active_j.destination_lng if active_j else None,
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
            selectinload(Journey.trip_events),
        )
        .order_by(Journey.started_at.desc())
    )
    if current_user.company_id:
        stmt = stmt.where(Journey.company_id == current_user.company_id)
    result = await db.execute(stmt)
    journeys = result.scalars().all()

    # Bulk query latest location per active journey (eliminates full location table scans)
    j_ids = [j.id for j in journeys]
    latest_loc_map = {}
    if j_ids:
        subq = (
            select(Location.journey_id, func.max(Location.recorded_at).label("max_rec"))
            .where(Location.journey_id.in_(j_ids))
            .group_by(Location.journey_id)
            .subquery()
        )
        stmt_bulk = (
            select(Location)
            .join(subq, (Location.journey_id == subq.c.journey_id) & (Location.recorded_at == subq.c.max_rec))
        )
        bulk_locs = (await db.execute(stmt_bulk)).scalars().all()
        for loc in bulk_locs:
            latest_loc_map[loc.journey_id] = loc

    output = []
    redis_svc = get_redis_service()
    for j in journeys:
        # Check Redis first for sub-millisecond live telemetry
        redis_loc = await redis_svc.get_latest_vehicle_location(j.vehicle_id)
        latest_ping_dto = None
        if redis_loc:
            from datetime import datetime
            latest_ping_dto = LocationPing(
                latitude=redis_loc["latitude"],
                longitude=redis_loc["longitude"],
                speed=redis_loc.get("speed") or 0.0,
                heading=redis_loc.get("heading") or 0.0,
                accuracy=0.0,
                altitude=0.0,
                timestamp=datetime.fromisoformat(redis_loc["timestamp"]) if redis_loc.get("timestamp") else j.started_at,
            )
        else:
            latest_loc = latest_loc_map.get(j.id)
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
                    accuracy=5.0,
                    altitude=0.0,
                    timestamp=j.started_at,
                )

        sorted_events = sorted(j.trip_events, key=lambda e: e.created_at) if j.trip_events else []
        latest_event = sorted_events[-1] if sorted_events else None

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
        .join(Journey, TripEvent.journey_id == Journey.id)
        .options(
            selectinload(TripEvent.journey).selectinload(Journey.vehicle),
            selectinload(TripEvent.journey).selectinload(Journey.driver),
        )
        .order_by(TripEvent.created_at.desc())
        .limit(limit)
    )
    if current_user.company_id:
        stmt = stmt.where(Journey.company_id == current_user.company_id)
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
