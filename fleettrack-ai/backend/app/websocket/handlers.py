import json
import logging
from typing import Optional
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.security import decode_access_token
from app.database.session import async_session_maker
from app.models.user import User
from app.models.vehicle import Vehicle
from app.websocket.manager import ws_manager
from sqlalchemy import select

logger = logging.getLogger("fleettrack.websocket.handlers")

ws_router = APIRouter()


async def authenticate_ws(websocket: WebSocket, token: Optional[str]) -> Optional[dict]:
    """Authenticate WebSocket connection via token query param or headers."""
    if not token:
        # Check Authorization header as fallback
        auth_header = websocket.headers.get("sec-websocket-protocol") or websocket.headers.get("authorization")
        if auth_header and "Bearer " in auth_header:
            token = auth_header.split("Bearer ")[1].strip()

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication token")
        return None

    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication token")
        return None

    return payload


@ws_router.websocket("/ws/tracking")
async def websocket_tracking(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """Real-time GPS vehicle location stream with client-side subscription support."""
    payload = await authenticate_ws(websocket, token)
    if not payload:
        return

    user_id = str(payload["sub"])
    role = str(payload.get("role", "fleet_manager"))

    # Fetch assigned vehicles for fleet manager
    assigned_vehicle_ids = set()
    if role != "admin":
        async with async_session_maker() as db:
            query = select(Vehicle.id).where(Vehicle.assigned_manager_id == user_id)
            result = await db.execute(query)
            assigned_vehicle_ids = {str(vid) for vid in result.scalars().all()}

    await ws_manager.connect_tracking(websocket, user_id, role, assigned_vehicle_ids)

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))

                elif msg_type == "subscribe":
                    vehicle_ids = data.get("vehicle_ids", [])
                    if isinstance(vehicle_ids, list):
                        ws_manager.subscribe(user_id, [str(v) for v in vehicle_ids])
                        await websocket.send_text(json.dumps({
                            "type": "subscribed",
                            "vehicle_ids": list(ws_manager.subscriptions.get(user_id, set()))
                        }))
                    else:
                        await websocket.send_text(json.dumps({"type": "error", "message": "vehicle_ids must be a list"}))

                elif msg_type == "unsubscribe":
                    vehicle_ids = data.get("vehicle_ids", [])
                    if isinstance(vehicle_ids, list):
                        ws_manager.unsubscribe(user_id, [str(v) for v in vehicle_ids])
                        await websocket.send_text(json.dumps({
                            "type": "unsubscribed",
                            "vehicle_ids": vehicle_ids
                        }))

                else:
                    await websocket.send_text(json.dumps({"type": "error", "message": f"Unknown message type: {msg_type}"}))

            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "message": "Invalid JSON format"}))

    except WebSocketDisconnect:
        await ws_manager.disconnect_tracking(websocket, user_id)
    except Exception as e:
        logger.error(f"WebSocket tracking error for user {user_id}: {e}")
        await ws_manager.disconnect_tracking(websocket, user_id)


@ws_router.websocket("/ws/notifications")
async def websocket_notifications(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """Real-time user notification alerts stream."""
    payload = await authenticate_ws(websocket, token)
    if not payload:
        return

    user_id = str(payload["sub"])
    await ws_manager.connect_notifications(websocket, user_id)

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                if data.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        await ws_manager.disconnect_notifications(websocket, user_id)
    except Exception as e:
        logger.error(f"WebSocket notifications error for user {user_id}: {e}")
        await ws_manager.disconnect_notifications(websocket, user_id)
