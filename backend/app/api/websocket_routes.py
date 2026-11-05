"""
Real-time WebSocket endpoints.
Distributes live coordinate streams to public viewers and corporate consoles.
"""
from __future__ import annotations

import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database.session import AsyncSessionLocal
from app.models.journey import Journey
from app.models.location import Location
from app.models.tracking_link import TrackingLink
from app.models.user import User
from app.security.jwt import decode_access_token
from app.services.journey_service import validate_tracking_token
from app.services.redis_service import get_redis_service
from app.websocket.manager import get_ws_manager

logger = logging.getLogger("fleettrack.ws_routes")
router = APIRouter(tags=["WebSockets"])


@router.websocket("/ws/track/{token}")
async def websocket_public_tracking(websocket: WebSocket, token: str):
    """
    Ephemeral WebSocket stream for temporary public tracking viewers.
    Validates token hash before connection upgrade.
    Terminates with code 4410 when journey completes.
    """
    ws_mgr = get_ws_manager()
    redis_svc = get_redis_service()

    # 1. Validate token before accepting connection
    async with AsyncSessionLocal() as db:
        res = await validate_tracking_token(db=db, token=token, redis_svc=redis_svc)
        if not res:
            logger.warning("Rejecting WebSocket connection: token invalid or expired")
            await websocket.close(code=4410, reason="Journey has ended or link is invalid")
            return
        journey, _ = res
        journey_id = journey.id
        vehicle_reg = journey.vehicle.registration_number
        origin = journey.origin_name
        destination = journey.destination_name

        # Fetch latest location
        latest_stmt = (
            select(Location)
            .where(Location.journey_id == journey_id)
            .order_by(Location.recorded_at.desc())
            .limit(1)
        )
        latest_res = await db.execute(latest_stmt)
        latest_loc = latest_res.scalar_one_or_none()

    # 2. Accept and register connection
    await ws_mgr.connect_journey(websocket, journey_id)

    # 3. Send INITIAL_STATE frame
    initial_data = {
        "type": "INITIAL_STATE",
        "journey_id": journey_id,
        "vehicle_registration": vehicle_reg,
        "origin": origin,
        "destination": destination,
        "latest_location": {
            "latitude": latest_loc.latitude if latest_loc else journey.origin_lat,
            "longitude": latest_loc.longitude if latest_loc else journey.origin_lng,
            "speed": latest_loc.speed if latest_loc else 0.0,
            "heading": latest_loc.heading if latest_loc else 0.0,
            "recorded_at": latest_loc.recorded_at.isoformat() if latest_loc else None,
        } if latest_loc else None,
    }
    await websocket.send_text(json.dumps(initial_data))

    # 4. Message loop (handles client ping/keepalive)
    try:
        while True:
            data = await websocket.receive_text()
            # Respond to client ping heartbeats
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_mgr.disconnect_journey(websocket, journey_id)
    except Exception as e:
        logger.error("WebSocket error for journey %s: %s", journey_id, e)
        await ws_mgr.disconnect_journey(websocket, journey_id)


@router.websocket("/ws/live-fleet")
async def websocket_live_fleet(websocket: WebSocket, token: str = ""):
    """
    Authenticated full-fleet live telemetry stream for corporate management console.
    Requires Bearer JWT in the connection query string.
    """
    ws_mgr = get_ws_manager()

    if not token:
        logger.warning("Rejecting fleet WebSocket: missing auth token")
        await websocket.close(code=4401, reason="Unauthorized: token required")
        return

    payload = decode_access_token(token)
    if not payload:
        logger.warning("Rejecting fleet WebSocket: invalid or expired token")
        await websocket.close(code=4401, reason="Unauthorized: invalid token")
        return

    role = payload.get("role")
    if role not in ("FLEET_MANAGER", "ADMIN"):
        logger.warning("Rejecting fleet WebSocket: forbidden role %s", role)
        await websocket.close(code=4403, reason="Forbidden: manager access required")
        return

    # Accept connection
    await ws_mgr.connect_fleet(websocket)

    # Send acknowledgment
    await websocket.send_text(json.dumps({
        "type": "FLEET_STREAM_CONNECTED",
        "authenticated_as": payload.get("name"),
        "role": role,
    }))

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_mgr.disconnect_fleet(websocket)
    except Exception as e:
        logger.error("Fleet WebSocket error: %s", e)
        await ws_mgr.disconnect_fleet(websocket)
