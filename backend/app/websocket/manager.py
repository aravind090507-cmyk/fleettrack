"""
WebSocket Connection Manager.
Handles live connections for public tracking links and corporate fleet consoles.
Features:
- Ephemeral journey stream management (code 4410 on journey completion)
- Multi-tenant company-scoped fleet consoles
- Coalesced WebSocket envelope buffering (<= 250ms batching)
- Background Pub/Sub subscriber integration
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, List, Optional, Any
from fastapi import WebSocket

logger = logging.getLogger("fleettrack.ws")


class ConnectionManager:
    def __init__(self):
        # Maps journey_id -> list of active WebSockets (public tracking viewers)
        self.journey_subscribers: Dict[str, List[WebSocket]] = {}
        # Fleet manager consoles listening to company vehicular movement
        self.fleet_company_subscribers: Dict[str, List[WebSocket]] = {}
        # Global admin subscribers
        self.fleet_subscribers: List[WebSocket] = []
        self._lock = asyncio.Lock()

        # Coalescing buffer: company_id -> {"devices": [...], "positions": [...], "events": [...]}
        self._coalesce_buffers: Dict[str, Dict[str, list]] = {}
        self._flush_tasks: Dict[str, asyncio.Task] = {}
        self._subscriber_task: Optional[asyncio.Task] = None

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

    async def connect_fleet(self, websocket: WebSocket, company_id: Optional[str] = None):
        await websocket.accept()
        async with self._lock:
            if company_id:
                if company_id not in self.fleet_company_subscribers:
                    self.fleet_company_subscribers[company_id] = []
                self.fleet_company_subscribers[company_id].append(websocket)
            else:
                self.fleet_subscribers.append(websocket)
        logger.info("Company console connected to fleet stream (Company: %s)", company_id or "Global")

    async def disconnect_fleet(self, websocket: WebSocket, company_id: Optional[str] = None):
        async with self._lock:
            if company_id and company_id in self.fleet_company_subscribers:
                if websocket in self.fleet_company_subscribers[company_id]:
                    self.fleet_company_subscribers[company_id].remove(websocket)
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

    async def broadcast_to_fleet(self, message: dict, company_id: Optional[str] = None):
        """Broadcast telemetry event to all connected company fleet consoles."""
        dead_sockets = []
        sockets = []
        async with self._lock:
            if company_id:
                if company_id in self.fleet_company_subscribers:
                    sockets.extend(self.fleet_company_subscribers[company_id])
            else:
                for comp_sockets in self.fleet_company_subscribers.values():
                    sockets.extend(comp_sockets)
            # Global manager consoles receive all fleet events
            sockets.extend(self.fleet_subscribers)

        text_data = json.dumps(message)
        for ws in sockets:
            try:
                await ws.send_text(text_data)
            except Exception:
                dead_sockets.append(ws)

        if dead_sockets:
            async with self._lock:
                if company_id and company_id in self.fleet_company_subscribers:
                    for ds in dead_sockets:
                        if ds in self.fleet_company_subscribers[company_id]:
                            self.fleet_company_subscribers[company_id].remove(ds)
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

    # --- Coalesced Telemetry Envelope Buffering ---
    async def queue_coalesced_update(
        self,
        company_id: Optional[str],
        position: Optional[Dict[str, Any]] = None,
        event: Optional[Dict[str, Any]] = None,
        device: Optional[Dict[str, Any]] = None,
    ):
        """Buffers positions, devices, and events into a batch and flushes <= 250ms."""
        cid = company_id or "global"
        async with self._lock:
            if cid not in self._coalesce_buffers:
                self._coalesce_buffers[cid] = {"devices": [], "positions": [], "events": []}
            buf = self._coalesce_buffers[cid]
            if position:
                buf["positions"].append(position)
            if event:
                buf["events"].append(event)
            if device:
                buf["devices"].append(device)

            if cid not in self._flush_tasks or self._flush_tasks[cid].done():
                self._flush_tasks[cid] = asyncio.create_task(self._delayed_flush(cid))

    async def _delayed_flush(self, company_id: str):
        await asyncio.sleep(0.2)  # 200ms coalescing window
        async with self._lock:
            buf = self._coalesce_buffers.pop(company_id, None)
            if not buf:
                return

        # Emit coalesced envelope
        envelope = {
            "type": "ENVELOPE",
            "devices": buf.get("devices", []),
            "positions": buf.get("positions", []),
            "events": buf.get("events", []),
        }
        await self.broadcast_to_fleet(envelope, company_id=None if company_id == "global" else company_id)

    # --- Pub/Sub Subscriber Loop ---
    async def start_subscriber(self, redis_svc):
        """Background task forwarding Redis Pub/Sub messages across multi-worker instances."""
        async def subscriber_loop():
            q = redis_svc.subscribe_in_memory("channel:fleet:broadcast")
            while True:
                try:
                    msg_str = await q.get()
                    if msg_str:
                        data = json.loads(msg_str)
                        # Route locally
                        cid = data.get("company_id")
                        await self.broadcast_to_fleet(data, company_id=cid)
                except asyncio.CancelledError:
                    break
                except Exception:
                    await asyncio.sleep(0.5)

        if not self._subscriber_task:
            self._subscriber_task = asyncio.create_task(subscriber_loop())

    def stop_subscriber(self):
        if self._subscriber_task:
            self._subscriber_task.cancel()
            self._subscriber_task = None


ws_manager = ConnectionManager()


def get_ws_manager() -> ConnectionManager:
    return ws_manager
