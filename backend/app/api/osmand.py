"""OsmAnd and Traccar Client HTTP protocol ingestion endpoint.
Ported from Traccar's OsmAndProtocolDecoder.java.
Supports GET query parameters, POST form-urlencoded, and POST JSON telemetry pings.
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any, Union
from fastapi import APIRouter, Depends, Request, Response, status, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.device import Device
from app.models.journey import Journey
from app.models.geofence import Geofence
from app.pipeline.runner import PipelineRunner
from app.pipeline.reasons import PipelineStatus
from app.pipeline import units
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

router = APIRouter(prefix="/api/osmand", tags=["OsmAnd / Traccar Client Protocol"])


def _parse_timestamp(raw_val: Any) -> datetime:
    if not raw_val:
        return datetime.now(timezone.utc)
    try:
        val_str = str(raw_val).strip()
        if val_str.isdigit():
            epoch = int(val_str)
            if epoch < 2000000000: # seconds
                return datetime.fromtimestamp(epoch, tz=timezone.utc)
            return datetime.fromtimestamp(epoch / 1000.0, tz=timezone.utc) # milliseconds
        return datetime.fromisoformat(val_str.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


async def _handle_osmand_payload(params: Dict[str, Any], db: AsyncSession) -> Response:
    # 1. Extract device identifier
    unique_id = params.get("id") or params.get("deviceid")
    if not unique_id:
        return Response(content="Missing device id", status_code=status.HTTP_400_BAD_REQUEST)

    # 2. Extract coordinates
    lat_val = params.get("lat")
    lon_val = params.get("lon")
    if lat_val is None or lon_val is None:
        loc = params.get("location")
        if loc and "," in str(loc):
            parts = str(loc).split(",")
            lat_val, lon_val = parts[0], parts[1]

    if lat_val is None or lon_val is None:
        return Response(content="Missing coordinates", status_code=status.HTTP_400_BAD_REQUEST)

    try:
        lat = float(lat_val)
        lon = float(lon_val)
    except (ValueError, TypeError):
        return Response(content="Invalid coordinates", status_code=status.HTTP_400_BAD_REQUEST)

    # 3. Lookup Device
    stmt = select(Device).where(Device.unique_id == str(unique_id))
    result = await db.execute(stmt)
    device = result.scalars().first()

    if not device:
        # Check by id
        stmt2 = select(Device).where(Device.id == str(unique_id))
        device = (await db.execute(stmt2)).scalars().first()

    if not device:
        return Response(content="Device not found", status_code=status.HTTP_404_NOT_FOUND)

    # 4. Check for active Journey linked to this device
    stmt_j = (
        select(Journey)
        .where(
            Journey.device_id == device.id,
            Journey.status == "IN_PROGRESS",
        )
        .order_by(Journey.started_at.desc())
        .limit(1)
    )
    journey = (await db.execute(stmt_j)).scalars().first()

    # 5. Speed (OsmAnd client sends speed in knots or m/s or km/h; standard is knots, convert to km/h)
    raw_speed = float(params.get("speed") or 0.0)
    # If speed is reported in knots (standard OsmAnd/Traccar protocol default)
    speed_kmh = units.kmh_from_knots(raw_speed) if raw_speed > 0 else 0.0

    bearing_deg = float(params.get("bearing") or params.get("heading") or 0.0)
    altitude_m = float(params.get("altitude")) if params.get("altitude") is not None else None
    accuracy_m = float(params.get("accuracy") or params.get("hdop") or 0.0)
    recorded_at = _parse_timestamp(params.get("timestamp"))

    ping_data = {
        "latitude": lat,
        "longitude": lon,
        "speed": speed_kmh,
        "heading": bearing_deg,
        "altitude": altitude_m,
        "accuracy": accuracy_m,
        "timestamp": recorded_at,
        "attributes": {
            "batt": params.get("batt"),
            "charge": params.get("charge"),
            "raw_speed": raw_speed,
        },
    }

    # 6. Query active geofences
    stmt_gf = select(Geofence).where(Geofence.company_id == device.company_id)
    gfs = (await db.execute(stmt_gf)).scalars().all()
    geofences_list = [{"id": g.id, "name": g.name, "geometry": g.geometry} for g in gfs]

    # 7. Run Pipeline
    runner = PipelineRunner(db)
    pipe_res = await runner.process_position(
        raw_ping=ping_data,
        device=device,
        journey=journey,
        geofences=geofences_list,
        protocol="osmand",
    )
    await db.commit()

    # 8. Broadcast update
    if pipe_res.status == PipelineStatus.RECORDED:
        redis_svc = get_redis_service()
        ws_mgr = get_ws_manager()

        loc_payload = {
            "type": "LOCATION_UPDATE",
            "device_id": device.id,
            "vehicle_id": device.vehicle_id,
            "journey_id": journey.id if journey else None,
            "latitude": pipe_res.position["latitude"],
            "longitude": pipe_res.position["longitude"],
            "speed": pipe_res.position["speed"],
            "heading": pipe_res.position.get("heading", 0.0),
            "total_distance_km": round(pipe_res.position["total_distance_m"] / 1000.0, 3),
            "timestamp": pipe_res.position["recorded_at"].isoformat(),
        }

        if device.vehicle_id:
            await redis_svc.set_vehicle_location(device.vehicle_id, loc_payload)
        await ws_mgr.broadcast_to_fleet(loc_payload, company_id=device.company_id)
        if journey:
            await ws_mgr.broadcast_to_journey(journey.id, loc_payload)

    return Response(content="OK", media_type="text/plain", status_code=status.HTTP_200_OK)


@router.get("")
async def osmand_get_ping(request: Request, db: AsyncSession = Depends(get_db)):
    """Handles GET request from OsmAnd / Traccar Client app."""
    params = dict(request.query_params)
    return await _handle_osmand_payload(params, db)


@router.post("")
async def osmand_post_ping(request: Request, db: AsyncSession = Depends(get_db)):
    """Handles POST request (form or JSON) from OsmAnd / Traccar Client app."""
    content_type = request.headers.get("content-type", "")
    params: Dict[str, Any] = dict(request.query_params)

    if "application/json" in content_type:
        try:
            body_json = await request.json()
            if isinstance(body_json, dict):
                params.update(body_json)
        except Exception:
            pass
    elif "application/x-www-form-urlencoded" in content_type:
        try:
            form_data = await request.form()
            params.update(dict(form_data))
        except Exception:
            pass

    return await _handle_osmand_payload(params, db)


# Root alias router for /osmand (standard Traccar client URL without /api prefix)
root_osmand_router = APIRouter(tags=["OsmAnd Root"])


@root_osmand_router.get("/osmand")
async def root_get_ping(request: Request, db: AsyncSession = Depends(get_db)):
    return await osmand_get_ping(request, db)


@root_osmand_router.post("/osmand")
async def root_post_ping(request: Request, db: AsyncSession = Depends(get_db)):
    return await osmand_post_ping(request, db)
