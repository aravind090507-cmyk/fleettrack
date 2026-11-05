"""
WebSocket Connection Manager.
Handles live connections for public tracking links and corporate fleet consoles.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("fleettrack.ws")


class ConnectionManager:
    def __init__(self):
        # Maps journey_id -> list of active WebSockets (public tracking viewers)
        self.journey_subscribers: Dict[str, List[WebSocket]] = {}
        # Fleet manager consoles listening to all vehicular movement
        self.fleet_subscribers: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect_journey(self, websocket: WebSocket, journey_id: str):
        await websocket.accept()
        async with self._lock:
            if journey_id not in self.journey_subscribers:
                self.journey_subscribers[journey_id] = []
            self.journey_subscribers[journey_id].append(websocket)
        logger.info("Client connected to journey stream: %s (Total: %d)", journey_id, len(self.journey_subscribers[journey_id]))

    async def disconnect_journey(self, websocket: WebSocket, journey_id: str):
        async with self._lock:
            if journey_id in self.journey_subscribers:
                if websocket in self.journey_subscribers[journey_id]:
                    self.journey_subscribers[journey_id].remove(websocket)
                if not self.journey_subscribers[journey_id]:
                    del self.journey_subscribers[journey_id]
        logger.info("Client disconnected from journey stream: %s", journey_id)

    async def connect_fleet(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.fleet_subscribers.append(websocket)
        logger.info("Company console connected to fleet stream (Total: %d)", len(self.fleet_subscribers))

    async def disconnect_fleet(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.fleet_subscribers:
                self.fleet_subscribers.remove(websocket)
        logger.info("Company console disconnected from fleet stream")

    async def broadcast_to_journey(self, journey_id: str, message: dict):
        """Broadcast live coordinate update or status event to all viewers of a journey."""
        dead_sockets = []
        sockets = []
        async with self._lock:
            sockets = list(self.journey_subscribers.get(journey_id, []))

        text_data = json.dumps(message)
        for ws in sockets:
            try:
                await ws.send_text(text_data)
            except Exception:
                dead_sockets.append(ws)

        if dead_sockets:
            async with self._lock:
                if journey_id in self.journey_subscribers:
                    for ds in dead_sockets:
                        if ds in self.journey_subscribers[journey_id]:
                            self.journey_subscribers[journey_id].remove(ds)

    async def broadcast_to_fleet(self, message: dict):
        """Broadcast telemetry event to all connected company fleet consoles."""
        dead_sockets = []
        async with self._lock:
            sockets = list(self.fleet_subscribers)

        text_data = json.dumps(message)
        for ws in sockets:
            try:
                await ws.send_text(text_data)
            except Exception:
                dead_sockets.append(ws)

        if dead_sockets:
            async with self._lock:
                for ds in dead_sockets:
                    if ds in self.fleet_subscribers:
                        self.fleet_subscribers.remove(ds)

    async def close_journey_connections(self, journey_id: str, code: int = 4410, reason: str = "Journey ended"):
        """Terminate all WebSocket connections for an ended journey with code 4410."""
        end_msg = json.dumps({"type": "JOURNEY_COMPLETED", "message": reason})
        async with self._lock:
            sockets = self.journey_subscribers.pop(journey_id, [])

        for ws in sockets:
            try:
                await ws.send_text(end_msg)
                await ws.close(code=code, reason=reason)
            except Exception:
                pass


ws_manager = ConnectionManager()


def get_ws_manager() -> ConnectionManager:
    return ws_manager
