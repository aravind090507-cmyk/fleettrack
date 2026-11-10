"""Location telemetry ingestion endpoints."""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.journey import Journey
from app.models.location import Location
from app.models.device import Device
from app.models.geofence import Geofence
from app.models.user import User
from app.schemas.location import LocationBatch, LocationIngestResult, LocationPing, LocationResponse
from app.security.dependencies import get_current_user, require_driver
from app.pipeline.runner import PipelineRunner
from app.pipeline.reasons import PipelineStatus
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("fleettrack.location")
router = APIRouter(prefix="/api/journeys", tags=["GPS Telemetry"])


async def _get_or_create_device_for_journey(db: AsyncSession, journey: Journey) -> Device:
    if journey.device_id:
        stmt = select(Device).where(Device.id == journey.device_id)
        dev = (await db.execute(stmt)).scalars().first()
        if dev:
            return dev

    import uuid
    stmt = select(Device).where(Device.vehicle_id == journey.vehicle_id)
    dev = (await db.execute(stmt)).scalars().first()
    if not dev:
        comp_id = journey.company_id
        if not comp_id and journey.vehicle:
            comp_id = journey.vehicle.company_id
        if not comp_id:
            from app.models.company import Company
            comp = (await db.execute(select(Company))).scalars().first()
            comp_id = comp.id if comp else None

        dev = Device(
            id=str(uuid.uuid4()),
            company_id=comp_id,
            unique_id=f"web-{journey.vehicle_id}"[:100],
            name=f"Web Tracker - {journey.vehicle_id}"[:255],
            vehicle_id=journey.vehicle_id,
            status="online",
        )
        db.add(dev)
        await db.flush()

    journey.device_id = dev.id
    return dev


async def _get_active_geofences(db: AsyncSession, company_id: Optional[str]) -> List[Dict[str, Any]]:
    if not company_id:
        return []
    stmt = select(Geofence).where(Geofence.company_id == company_id)
    gfs = (await db.execute(stmt)).scalars().all()
    return [{"id": g.id, "name": g.name, "geometry": g.geometry} for g in gfs]


@router.post("/{journey_id}/location", response_model=LocationIngestResult)
async def post_single_location_ping(
    journey_id: str,
    ping: LocationPing,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest real-time GPS coordinate ping through the Traccar pipeline.
    Validates, corrects time skew, suppresses jitter, evaluates geofences, and pushes updates.
    """
    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    if not journey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Journey not found",
        )

    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if journey.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cannot upload GPS telemetry for a completed or inactive journey",
        )

    device = await _get_or_create_device_for_journey(db, journey)
    geofences = await _get_active_geofences(db, journey.company_id)

    runner = PipelineRunner(db)
    res = await runner.process_position(
        raw_ping=ping.model_dump(),
        device=device,
        journey=journey,
        geofences=geofences,
        protocol="web",
    )
    await db.commit()

    # Broadcast update if recorded
    if res.status == PipelineStatus.RECORDED:
        redis_svc = get_redis_service()
        ws_mgr = get_ws_manager()

        rec_iso = res.position["recorded_at"].isoformat()
        loc_payload = {
            "type": "LOCATION_UPDATE",
            "journey_id": journey.id,
            "vehicle_id": journey.vehicle_id,
            "device_id": device.id,
            "latitude": res.position["latitude"],
            "longitude": res.position["longitude"],
            "speed": res.position["speed"],
            "heading": res.position.get("heading", 0.0),
            "accuracy": res.position.get("accuracy", 0.0),
            "total_distance_km": journey.total_distance_km,
            "timestamp": rec_iso,
            "recorded_at": rec_iso,
        }

        await redis_svc.set_vehicle_location(journey.vehicle_id, loc_payload)
        await ws_mgr.broadcast_to_journey(journey.id, loc_payload)
        
        effective_company_id = journey.company_id or (journey.vehicle.company_id if journey.vehicle else None)
        await ws_mgr.broadcast_to_fleet(loc_payload, company_id=effective_company_id)
        await ws_mgr.queue_coalesced_update(company_id=effective_company_id, position=loc_payload)

    status_str = "recorded" if res.status == PipelineStatus.RECORDED else res.status.value
    now_utc = datetime.now(timezone.utc)
    return LocationIngestResult(
        status=status_str,
        pings_processed=1 if res.status == PipelineStatus.RECORDED else 0,
        received_at=now_utc,
        server_time=now_utc,
        accepted_count=1 if res.status == PipelineStatus.RECORDED else 0,
        rejected_count=1 if res.status == PipelineStatus.REJECTED else 0,
        filtered_count=1 if res.status == PipelineStatus.FILTERED else 0,
        results=[res.to_dict()],
    )


@router.post("/{journey_id}/location/batch", response_model=LocationIngestResult)
async def post_batch_location_pings(
    journey_id: str,
    batch: LocationBatch,
    current_user: User = Depends(require_driver),
    db: AsyncSession = Depends(get_db),
):
    """
    Synchronize accumulated offline telemetry after network reconnection.
    Capped at 1000 pings with HTTP 413 on exceed.
    Allows late offline sync within 6-hour grace window, otherwise returns 409 journey_ended.
    """
    if len(batch.pings) > 1000:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Payload Too Large: batch exceeds maximum 1000 pings",
        )

    stmt = select(Journey).where(Journey.id == journey_id)
    result = await db.execute(stmt)
    journey = result.scalar_one_or_none()

    if not journey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Journey not found",
        )

    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    now_utc = datetime.now(timezone.utc)

    # Journey lifecycle checks
    if journey.status != "IN_PROGRESS":
        ended_at = journey.ended_at or journey.started_at
        if ended_at.tzinfo is None:
            ended_at = ended_at.replace(tzinfo=timezone.utc)

        grace_cutoff = ended_at + timedelta(hours=6)
        if now_utc > grace_cutoff:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "journey_ended", "status": journey.status, "ended_at": ended_at.isoformat()},
            )

        # Check if batch contains points recorded after journey ended
        has_post_end_points = any(
            (p.timestamp.replace(tzinfo=timezone.utc) if p.timestamp.tzinfo is None else p.timestamp) > ended_at
            for p in batch.pings
        )
        if has_post_end_points:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "journey_ended", "status": journey.status, "ended_at": ended_at.isoformat()},
            )

    device = await _get_or_create_device_for_journey(db, journey)
    geofences = await _get_active_geofences(db, journey.company_id)

    sorted_pings = sorted(batch.pings, key=lambda p: p.timestamp)
    runner = PipelineRunner(db)

    accepted = 0
    filtered = 0
    rejected = 0
    results_list = []
    last_recorded_pos = None

    for idx, p in enumerate(sorted_pings):
        res = await runner.process_position(
            raw_ping=p.model_dump(),
            device=device,
            journey=journey,
            geofences=geofences,
            protocol="web",
        )
        if res.status == PipelineStatus.RECORDED:
            accepted += 1
            last_recorded_pos = res.position
        elif res.status == PipelineStatus.FILTERED:
            filtered += 1
        else:
            rejected += 1

        results_list.append({
            "index": idx,
            "timestamp": p.timestamp.isoformat(),
            **res.to_dict(),
        })

    await db.commit()

    # Broadcast latest recorded position if any were accepted
    if last_recorded_pos:
        redis_svc = get_redis_service()
        ws_mgr = get_ws_manager()

        rec_iso = last_recorded_pos["recorded_at"].isoformat()
        loc_payload = {
            "type": "LOCATION_UPDATE",
            "journey_id": journey.id,
            "vehicle_id": journey.vehicle_id,
            "device_id": device.id,
            "latitude": last_recorded_pos["latitude"],
            "longitude": last_recorded_pos["longitude"],
            "speed": last_recorded_pos["speed"],
            "heading": last_recorded_pos.get("heading", 0.0),
            "accuracy": last_recorded_pos.get("accuracy", 0.0),
            "total_distance_km": journey.total_distance_km,
            "timestamp": rec_iso,
            "recorded_at": rec_iso,
        }
        await redis_svc.set_vehicle_location(journey.vehicle_id, loc_payload)
        await ws_mgr.broadcast_to_journey(journey.id, loc_payload)
        
        effective_company_id = journey.company_id or (journey.vehicle.company_id if journey.vehicle else None)
        await ws_mgr.broadcast_to_fleet(loc_payload, company_id=effective_company_id)
        await ws_mgr.queue_coalesced_update(company_id=effective_company_id, position=loc_payload)

    return LocationIngestResult(
        status="batch_recorded",
        pings_processed=accepted,
        received_at=now_utc,
        server_time=now_utc,
        accepted_count=accepted,
        rejected_count=rejected,
        filtered_count=filtered,
        results=results_list,
    )


@router.get("/{journey_id}/location", response_model=List[LocationResponse])
async def get_journey_location_history(
    journey_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve historical GPS track for route reconstruction and playback."""
    j_stmt = select(Journey).where(Journey.id == journey_id)
    j_res = await db.execute(j_stmt)
    journey = j_res.scalar_one_or_none()
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")
    if current_user.company_id and journey.company_id and journey.company_id != current_user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role == "DRIVER" and journey.driver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    stmt = (
        select(Location)
        .where(Location.journey_id == journey_id)
        .order_by(Location.recorded_at.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    locations = result.scalars().all()
    return [LocationResponse.model_validate(loc) for loc in locations]


@router.get("/{journey_id}/location/latest", response_model=Optional[LocationResponse])
async def get_journey_latest_location(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve the most recent coordinate point for a journey."""
    stmt = (
        select(Location)
        .where(Location.journey_id == journey_id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    loc = result.scalar_one_or_none()
    return LocationResponse.model_validate(loc) if loc else None


# Dedicated Location Search & Geocoding Router
search_router = APIRouter(prefix="/api/locations", tags=["Geocoding & Location Search"])


@search_router.get("/search")
async def search_places(q: str = Query(..., min_length=1)):
    """
    Search locations by name, landmark, city, or address using OpenStreetMap Nominatim.
    Also parses direct lat,lng coordinate strings.
    """
    import re
    import httpx

    query = q.strip()

    # 1. Parse direct coordinate input (e.g. "12.9716, 77.5946")
    coord_pattern = r"^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)[,\s]+[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$"
    if re.match(coord_pattern, query):
        parts = re.split(r"[,\s]+", query)
        try:
            lat = float(parts[0])
            lon = float(parts[1])
            return [
                {
                    "display_name": f"Coordinates: {lat:.6f}, {lon:.6f}",
                    "lat": lat,
                    "lon": lon,
                    "type": "coordinate",
                }
            ]
        except (ValueError, IndexError):
            pass

    # 2. Query OpenStreetMap Nominatim
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": query,
        "format": "json",
        "limit": 6,
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "FleetTrackEnterprise/1.0 (geospatial-fleet-geocoder)",
    }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data:
                    try:
                        results.append({
                            "display_name": item.get("display_name", query),
                            "lat": float(item["lat"]),
                            "lon": float(item["lon"]),
                            "type": item.get("type", "place"),
                        })
                    except (KeyError, ValueError):
                        continue
                return results
    except Exception as exc:
        logger.warning("Geocoding lookup failed for query '%s': %s", query, exc)

    return []
