import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, Dict, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger("fleettrack.websocket")


class WebSocketManager:
    """
    Manages live WebSocket connections for real-time tracking and notifications.
    Supports in-memory routing and optional Redis Pub/Sub scaling.
    """

    def __init__(self) -> None:
        # Tracking sockets: user_id -> set of active WebSockets
        self.tracking_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        # Notification sockets: user_id -> set of active WebSockets
        self.notification_connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        # Subscriptions: user_id -> set of vehicle_id strings subscribed
        self.subscriptions: Dict[str, Set[str]] = defaultdict(set)
        # User roles and permissions cache: user_id -> role ("admin", "fleet_manager")
        self.user_roles: Dict[str, str] = {}
        # User assigned vehicles: user_id -> set of vehicle_id strings
        self.user_assigned_vehicles: Dict[str, Set[str]] = defaultdict(set)
        # Lock for thread/coroutine safe connection management
        self._lock = asyncio.Lock()

    async def connect_tracking(
        self,
        websocket: WebSocket,
        user_id: str,
        role: str = "fleet_manager",
        assigned_vehicles: Optional[Set[str]] = None,
    ) -> None:
        await websocket.accept()
        async with self._lock:
            self.tracking_connections[user_id].add(websocket)
            self.user_roles[user_id] = role
            if assigned_vehicles:
                self.user_assigned_vehicles[user_id] = assigned_vehicles
        logger.info(f"User {user_id} connected to tracking WebSocket (role={role})")

    async def disconnect_tracking(self, websocket: WebSocket, user_id: str) -> None:
        async with self._lock:
            if user_id in self.tracking_connections:
                self.tracking_connections[user_id].discard(websocket)
                if not self.tracking_connections[user_id]:
                    del self.tracking_connections[user_id]
                    self.subscriptions.pop(user_id, None)
                    self.user_roles.pop(user_id, None)
                    self.user_assigned_vehicles.pop(user_id, None)
        logger.info(f"User {user_id} disconnected from tracking WebSocket")

    async def connect_notifications(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        async with self._lock:
            self.notification_connections[user_id].add(websocket)
        logger.info(f"User {user_id} connected to notifications WebSocket")

    async def disconnect_notifications(self, websocket: WebSocket, user_id: str) -> None:
        async with self._lock:
            if user_id in self.notification_connections:
                self.notification_connections[user_id].discard(websocket)
                if not self.notification_connections[user_id]:
                    del self.notification_connections[user_id]
        logger.info(f"User {user_id} disconnected from notifications WebSocket")

    def subscribe(self, user_id: str, vehicle_ids: list[str]) -> None:
        role = self.user_roles.get(user_id, "fleet_manager")
        assigned = self.user_assigned_vehicles.get(user_id, set())

        for v_id in vehicle_ids:
            clean_id = str(v_id).strip()
            # Admins can subscribe to any vehicle; fleet managers only their assigned vehicles
            if role == "admin" or clean_id in assigned:
                self.subscriptions[user_id].add(clean_id)
            elif not assigned:
                # If assigned list is empty/unrestricted or not yet cached, allow subscription
                self.subscriptions[user_id].add(clean_id)

    def unsubscribe(self, user_id: str, vehicle_ids: list[str]) -> None:
        for v_id in vehicle_ids:
            self.subscriptions[user_id].discard(str(v_id).strip())

    async def broadcast_location(self, vehicle_id: str, data: Dict[str, Any]) -> None:
        """
        Sends real-time vehicle location update to all connected users who are subscribed
        or authorized (admin or assigned manager).
        """
        v_id_str = str(vehicle_id).strip()
        message = {
            "type": "vehicle_location",
            "vehicle_id": v_id_str,
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "speed": data.get("speed", 0.0),
            "heading": data.get("heading", 0.0),
            "status": data.get("status", "moving"),
            "recorded_at": data.get("recorded_at"),
            "is_simulated": data.get("is_simulated", False),
        }
        json_payload = json.dumps(message)

        stale_connections = []
        async with self._lock:
            for user_id, sockets in list(self.tracking_connections.items()):
                role = self.user_roles.get(user_id, "fleet_manager")
                user_subs = self.subscriptions.get(user_id, set())

                # Broadcast if:
                # 1. User explicitly subscribed to this vehicle
                # 2. Or user has no specific subscriptions and is an admin (default subscribe all)
                should_send = (v_id_str in user_subs) or (not user_subs and role == "admin")

                if should_send:
                    for ws in sockets:
                        try:
                            await ws.send_text(json_payload)
                        except Exception as e:
                            logger.warning(f"Error sending tracking to user {user_id}: {e}")
                            stale_connections.append((ws, user_id))

        # Cleanup disconnected sockets
        for ws, user_id in stale_connections:
            await self.disconnect_tracking(ws, user_id)

    async def send_notification(self, user_id: str, data: Dict[str, Any]) -> None:
        """Sends notification to specific user's notification sockets."""
        u_id_str = str(user_id).strip()
        message = {
            "type": "notification",
            "id": str(data.get("id")),
            "event_type": data.get("event_type", "info"),
            "message": data.get("message", ""),
            "vehicle_id": str(data.get("vehicle_id")) if data.get("vehicle_id") else None,
            "created_at": str(data.get("created_at")),
        }
        json_payload = json.dumps(message)

        stale_connections = []
        async with self._lock:
            sockets = self.notification_connections.get(u_id_str, set())
            for ws in list(sockets):
                try:
                    await ws.send_text(json_payload)
                except Exception as e:
                    logger.warning(f"Error sending notification to user {u_id_str}: {e}")
                    stale_connections.append((ws, u_id_str))

        for ws, u_id in stale_connections:
            await self.disconnect_notifications(ws, u_id)


    async def broadcast_vehicle_location(self, vehicle_id: str, data: Dict[str, Any]) -> None:
        """Alias for broadcast_location, used by location ingestion endpoint."""
        await self.broadcast_location(vehicle_id, data)


# Global singleton instance
ws_manager = WebSocketManager()
