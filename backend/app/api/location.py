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
from app.models.geofence import Geofence
from app.models.user import User
from app.models.trip_event import TripEvent
from app.models.delivery_assignment import DeliveryAssignment
from app.schemas.location import LocationBatch, LocationIngestResult, LocationPing, LocationResponse
from app.security.dependencies import get_current_user, require_driver
from app.pipeline.runner import PipelineRunner
from app.pipeline.reasons import PipelineStatus
from app.services.redis_service import get_redis_service
from app.services.journey_service import haversine_distance, end_journey
from app.websocket.manager import get_ws_manager
from sqlalchemy.orm import selectinload

logger = logging.getLogger("fleettrack.location")
router = APIRouter(prefix="/api/journeys", tags=["GPS Telemetry"])


async def _get_active_geofences(db: AsyncSession, company_id: Optional[str]) -> List[Dict[str, Any]]:
    if not company_id:
        return []
    stmt = select(Geofence).where(Geofence.company_id == company_id)
    gfs = (await db.execute(stmt)).scalars().all()
    return [{"id": g.id, "name": g.name, "geometry": g.geometry, "kind": g.kind} for g in gfs]


async def _process_geofence_and_arrival_events(
    db: AsyncSession,
    journey: Journey,
    position: Dict[str, Any],
    events: List[Dict[str, Any]],
    redis_svc: Any,
    ws_mgr: Any,
    effective_company_id: Optional[str],
):
    """
    Evaluates detected geofence entry/exit events and destination arrival.
    Generates persistent TripEvent notifications and handles automatic completion safely.
    """
    v_reg = journey.vehicle.registration_number if journey.vehicle else None
    d_name = journey.driver.name if journey.driver else None

    # 1. Process Geofence Enter & Exit Notifications
    for evt in events:
        evt_type = evt.get("type")
        if evt_type in ("geofenceEnter", "geofenceExit"):
            is_enter = (evt_type == "geofenceEnter")
            gf_name = evt.get("geofence_name") or evt.get("attributes", {}).get("geofence_name") or "Geofence Perimeter"
            gf_id = evt.get("geofence_id")
            gf_kind = evt.get("attributes", {}).get("kind") or "circle"
            display_ev_type = "GEOFENCE ENTERED" if is_enter else "GEOFENCE EXITED"
            internal_ev_type = "GEOFENCE_ENTER" if is_enter else "GEOFENCE_EXIT"

            trip_ev = TripEvent(
                journey_id=journey.id,
                event_type=internal_ev_type,
                latitude=float(position.get("latitude", 0.0)),
                longitude=float(position.get("longitude", 0.0)),
                metadata_json={
                    "geofence_id": gf_id,
                    "geofence_name": gf_name,
                    "vehicle_registration": v_reg,
                    "driver_name": d_name,
                    "kind": gf_kind,
                    "location": f"{round(position.get('latitude', 0.0), 5)}, {round(position.get('longitude', 0.0), 5)}",
                    "event_type": display_ev_type,
                },
            )
            db.add(trip_ev)
            await db.commit()

            # Real-time WebSocket push to Manager Console
            gf_alert_msg = {
                "type": "TRIP_EVENT",
                "id": trip_ev.id,
                "event_type": trip_ev.event_type,
                "journey_id": journey.id,
                "vehicle_id": journey.vehicle_id,
                "vehicle_registration": v_reg,
                "driver_name": d_name,
                "geofence_name": gf_name,
                "latitude": trip_ev.latitude,
                "longitude": trip_ev.longitude,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "metadata": trip_ev.metadata_json,
                "company_id": effective_company_id,
            }
            await ws_mgr.broadcast_to_fleet(gf_alert_msg, company_id=effective_company_id)

    # 2. Destination Arrival Detection & Automatic Completion
    if (
        journey.destination_lat is not None
        and journey.destination_lng is not None
        and journey.status == "IN_PROGRESS"
    ):
        lat = float(position.get("latitude", 0.0))
        lng = float(position.get("longitude", 0.0))
        acc = float(position.get("accuracy", 0.0) or 0.0)
        spd = float(position.get("speed", 0.0) or 0.0)

        # Distance to target destination in meters
        dist_to_dest_m = haversine_distance(lat, lng, journey.destination_lat, journey.destination_lng) * 1000.0

        # Reliable confirmation conditions:
        # a) GPS accuracy within 100m (filters cell-tower jitter)
        # b) Within arrival radius (<= 100m)
        is_accurate = (acc <= 100.0 or acc == 0.0)
        within_radius = (dist_to_dest_m <= 100.0)

        if is_accurate and within_radius:
            reached_key = f"journey:{journey.id}:destination_reached"
            dwell_key = f"journey:{journey.id}:arrival_dwell"

            # Check if this journey has already triggered arrival
            already_reached = await redis_svc.get(reached_key)
            if not already_reached and journey.status == "IN_PROGRESS":
                now_dt = datetime.now(timezone.utc)
                first_dwell = await redis_svc.get(dwell_key)
                confirmed = False

                if spd <= 25.0:
                    # Slowing down, stopping or parked at destination
                    confirmed = True
                elif not first_dwell:
                    # First fix inside arrival radius, start dwell timer
                    await redis_svc.set(dwell_key, str(now_dt.timestamp()), ex=1800)
                else:
                    # Dwell confirmation
                    try:
                        elapsed = now_dt.timestamp() - float(first_dwell)
                        if elapsed >= 3.0:
                            confirmed = True
                    except Exception:
                        confirmed = True

                if confirmed:
                    # Mark arrival as processed in Redis (prevents duplicate triggers)
                    await redis_svc.set(reached_key, "1", ex=86400)
                    now_naive = now_dt.replace(tzinfo=None)

                    # Create DESTINATION_REACHED TripEvent
                    arr_event = TripEvent(
                        journey_id=journey.id,
                        event_type="DESTINATION_REACHED",
                        latitude=lat,
                        longitude=lng,
                        metadata_json={
                            "destination_name": journey.destination_name,
                            "destination_lat": journey.destination_lat,
                            "destination_lng": journey.destination_lng,
                            "distance_m": round(dist_to_dest_m, 1),
                            "vehicle_registration": v_reg,
                            "driver_name": d_name,
                            "arrival_time": now_dt.isoformat(),
                            "event_type": "DESTINATION REACHED",
                            "completion_status": "COMPLETED",
                        },
                    )
                    db.add(arr_event)
                    await db.flush()

                    # Find and complete associated DeliveryAssignment
                    asg_stmt = (
                        select(DeliveryAssignment)
                        .where(
                            DeliveryAssignment.journey_id == journey.id,
                            DeliveryAssignment.status.in_(["IN_PROGRESS", "ACCEPTED", "PENDING"]),
                        )
                        .options(selectinload(DeliveryAssignment.driver))
                    )
                    asg = (await db.execute(asg_stmt)).scalar_one_or_none()
                    if not asg and journey.driver_id:
                        asg_stmt2 = (
                            select(DeliveryAssignment)
                            .where(
                                DeliveryAssignment.driver_id == journey.driver_id,
                                DeliveryAssignment.status.in_(["IN_PROGRESS", "ACCEPTED"]),
                            )
                            .options(selectinload(DeliveryAssignment.driver))
                        )
                        asg = (await db.execute(asg_stmt2)).scalar_one_or_none()

                    if asg:
                        asg.status = "COMPLETED"
                        asg.completed_at = now_naive
                        if asg.driver:
                            asg.driver.availability = asg.driver.availability_preference or "AVAILABLE"
                            asg.driver.availability_updated_at = now_naive

                    # Conclude the journey through existing end_journey lifecycle
                    await end_journey(
                        db=db,
                        journey_id=journey.id,
                        driver_id=journey.driver_id,
                        redis_svc=redis_svc,
                        ws_mgr=ws_mgr,
                    )

                    # Notify manager console of automatic destination arrival
                    dest_msg = {
                        "type": "DESTINATION_REACHED",
                        "journey_id": journey.id,
                        "vehicle_id": journey.vehicle_id,
                        "vehicle_registration": v_reg,
                        "driver_name": d_name,
                        "destination_name": journey.destination_name,
                        "destination_lat": journey.destination_lat,
                        "destination_lng": journey.destination_lng,
                        "arrival_time": now_dt.isoformat(),
                        "event_type": "DESTINATION REACHED",
                        "completion_status": "COMPLETED",
                        "company_id": effective_company_id,
                    }
                    await ws_mgr.broadcast_to_fleet(dest_msg, company_id=effective_company_id)
                    await ws_mgr.broadcast_to_fleet({
                        "type": "TRIP_EVENT",
                        "id": arr_event.id,
                        "event_type": "DESTINATION_REACHED",
                        "journey_id": journey.id,
                        "vehicle_id": journey.vehicle_id,
                        "vehicle_registration": v_reg,
                        "driver_name": d_name,
                        "created_at": now_dt.isoformat(),
                        "metadata": arr_event.metadata_json,
                        "company_id": effective_company_id,
                    }, company_id=effective_company_id)

                    # Notify driver console
                    if journey.driver_id:
                        await ws_mgr.broadcast_to_driver(journey.driver_id, {
                            "type": "DESTINATION_REACHED",
                            "journey_id": journey.id,
                            "status": "COMPLETED",
                            "message": "Destination reached! Delivery completed.",
                        })


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
    stmt = (
        select(Journey)
        .where(Journey.id == journey_id)
        .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
    )
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

    geofences = await _get_active_geofences(db, journey.company_id)

    runner = PipelineRunner(db)
    res = await runner.process_position(
        raw_ping=ping.model_dump(),
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
        spd = float(res.position.get("speed") or 0.0)
        adaptive_state = getattr(ping, "adaptive_state", None) or (
            "MOVING" if spd > 5.0 else ("TRAFFIC" if spd > 1.5 else "STATIONARY")
        )
        acq_interval = getattr(ping, "acquisition_interval_sec", None) or (
            5 if adaptive_state == "MOVING" else (15 if adaptive_state == "TRAFFIC" else (30 if adaptive_state == "STATIONARY" else 60))
        )
        trans_interval = getattr(ping, "transmission_interval_sec", None) or acq_interval
        battery_saving = getattr(ping, "battery_saving", None) if getattr(ping, "battery_saving", None) is not None else (adaptive_state == "EXTENDED_IDLE")

        loc_payload = {
            "type": "LOCATION_UPDATE",
            "journey_id": journey.id,
            "vehicle_id": journey.vehicle_id,
            "latitude": res.position["latitude"],
            "longitude": res.position["longitude"],
            "speed": res.position["speed"],
            "heading": res.position.get("heading", 0.0),
            "accuracy": res.position.get("accuracy", 0.0),
            "total_distance_km": journey.total_distance_km,
            "timestamp": rec_iso,
            "recorded_at": rec_iso,
            "adaptive_state": adaptive_state,
            "acquisition_interval_sec": acq_interval,
            "transmission_interval_sec": trans_interval,
            "battery_saving": battery_saving,
        }

        await redis_svc.set_vehicle_location(journey.vehicle_id, loc_payload)
        await ws_mgr.broadcast_to_journey(journey.id, loc_payload)
        
        effective_company_id = journey.company_id or (journey.vehicle.company_id if journey.vehicle else None)
        await ws_mgr.broadcast_to_fleet(loc_payload, company_id=effective_company_id)
        await ws_mgr.queue_coalesced_update(company_id=effective_company_id, position=loc_payload)

        # Process geofence containment transitions and destination arrival detection
        await _process_geofence_and_arrival_events(
            db=db,
            journey=journey,
            position=res.position,
            events=res.events,
            redis_svc=redis_svc,
            ws_mgr=ws_mgr,
            effective_company_id=effective_company_id,
        )

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

    stmt = (
        select(Journey)
        .where(Journey.id == journey_id)
        .options(selectinload(Journey.vehicle), selectinload(Journey.driver))
    )
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

    geofences = await _get_active_geofences(db, journey.company_id)

    sorted_pings = sorted(batch.pings, key=lambda p: p.timestamp)
    runner = PipelineRunner(db)

    accepted = 0
    filtered = 0
    rejected = 0
    results_list = []
    last_recorded_pos = None
    batch_events = []

    for idx, p in enumerate(sorted_pings):
        res = await runner.process_position(
            raw_ping=p.model_dump(),
            journey=journey,
            geofences=geofences,
            protocol="web",
        )
        if res.status == PipelineStatus.RECORDED:
            accepted += 1
            last_recorded_pos = res.position
            if res.events:
                batch_events.extend(res.events)
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
        last_ping = payload.pings[-1]
        spd = float(last_recorded_pos.get("speed") or 0.0)
        adaptive_state = getattr(last_ping, "adaptive_state", None) or (
            "MOVING" if spd > 5.0 else ("TRAFFIC" if spd > 1.5 else "STATIONARY")
        )
        acq_interval = getattr(last_ping, "acquisition_interval_sec", None) or (
            5 if adaptive_state == "MOVING" else (15 if adaptive_state == "TRAFFIC" else (30 if adaptive_state == "STATIONARY" else 60))
        )
        trans_interval = getattr(last_ping, "transmission_interval_sec", None) or acq_interval
        battery_saving = getattr(last_ping, "battery_saving", None) if getattr(last_ping, "battery_saving", None) is not None else (adaptive_state == "EXTENDED_IDLE")

        loc_payload = {
            "type": "LOCATION_UPDATE",
            "journey_id": journey.id,
            "vehicle_id": journey.vehicle_id,
            "latitude": last_recorded_pos["latitude"],
            "longitude": last_recorded_pos["longitude"],
            "speed": last_recorded_pos["speed"],
            "heading": last_recorded_pos.get("heading", 0.0),
            "accuracy": last_recorded_pos.get("accuracy", 0.0),
            "total_distance_km": journey.total_distance_km,
            "timestamp": rec_iso,
            "recorded_at": rec_iso,
            "adaptive_state": adaptive_state,
            "acquisition_interval_sec": acq_interval,
            "transmission_interval_sec": trans_interval,
            "battery_saving": battery_saving,
        }
        await redis_svc.set_vehicle_location(journey.vehicle_id, loc_payload)
        await ws_mgr.broadcast_to_journey(journey.id, loc_payload)
        
        effective_company_id = journey.company_id or (journey.vehicle.company_id if journey.vehicle else None)
        await ws_mgr.broadcast_to_fleet(loc_payload, company_id=effective_company_id)
        await ws_mgr.queue_coalesced_update(company_id=effective_company_id, position=loc_payload)

        # Process geofence containment transitions and destination arrival detection
        await _process_geofence_and_arrival_events(
            db=db,
            journey=journey,
            position=last_recorded_pos,
            events=batch_events,
            redis_svc=redis_svc,
            ws_mgr=ws_mgr,
            effective_company_id=effective_company_id,
        )

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
    """Retrieve historical GPS track for route reconstruction."""
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


@search_router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
):
    """
    Reverse geocoding using OpenStreetMap Nominatim with graceful coordinate fallback.
    """
    import httpx

    fallback_name = f"Location ({lat:.5f}, {lon:.5f})"
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "lat": lat,
        "lon": lon,
        "format": "json",
        "zoom": 18,
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
                display_name = data.get("display_name") or fallback_name
                return {
                    "display_name": display_name,
                    "lat": lat,
                    "lon": lon,
                    "address": data.get("address", {}),
                }
    except Exception as exc:
        logger.warning("Reverse geocoding failed for %s, %s: %s", lat, lon, exc)

    return {
        "display_name": fallback_name,
        "lat": lat,
        "lon": lon,
        "address": {},
    }

