"""
Redis Service with automatic In-Memory Fallback.
Provides low-latency caching, GEO commands, and Pub/Sub message distribution.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional, Dict, Any

from app.config.settings import get_settings

logger = logging.getLogger("fleettrack.redis")
settings = get_settings()


class InMemoryPubSub:
    """In-memory Pub/Sub channel for local development without Redis."""
    def __init__(self):
        self._subscribers: Dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        if channel not in self._subscribers:
            self._subscribers[channel] = []
        self._subscribers[channel].append(q)
        return q

    def unsubscribe(self, channel: str, q: asyncio.Queue):
        if channel in self._subscribers and q in self._subscribers[channel]:
            self._subscribers[channel].remove(q)
            if not self._subscribers[channel]:
                del self._subscribers[channel]

    async def publish(self, channel: str, message: str) -> int:
        count = 0
        if channel in self._subscribers:
            for q in list(self._subscribers[channel]):
                try:
                    await q.put(message)
                    count += 1
                except Exception:
                    pass
        return count


class RedisService:
    """Manages Redis interactions with transparent in-memory fallback."""

    def __init__(self):
        self._client = None
        self._is_connected = False
        # In-memory stores
        self._memory_kv: Dict[str, str] = {}
        self._memory_pubsub = InMemoryPubSub()

    async def initialize(self):
        """Attempt connection to Redis."""
        try:
            import redis.asyncio as aioredis
            self._client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2.0
            )
            await self._client.ping()
            self._is_connected = True
            logger.info("Connected to Redis successfully at %s", settings.REDIS_URL)
        except Exception as e:
            self._is_connected = False
            self._client = None
            logger.warning("Redis unavailable (%s). Falling back to resilient in-memory storage.", str(e))

    async def close(self):
        if self._client and self._is_connected:
            await self._client.close()

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    # --- Ephemeral Token Management ---
    async def set_tracking_token(self, token_hash: str, journey_id: str, expire_hours: int = 24):
        key = f"token:{token_hash}"
        if self._is_connected and self._client:
            try:
                await self._client.set(key, journey_id, ex=expire_hours * 3600)
                return
            except Exception as e:
                logger.error("Redis set error: %s", e)
        self._memory_kv[key] = journey_id

    async def get_journey_id_by_token_hash(self, token_hash: str) -> Optional[str]:
        key = f"token:{token_hash}"
        if self._is_connected and self._client:
            try:
                val = await self._client.get(key)
                if val:
                    return val
            except Exception as e:
                logger.error("Redis get error: %s", e)
        return self._memory_kv.get(key)

    async def revoke_tracking_token(self, token_hash: str):
        key = f"token:{token_hash}"
        if self._is_connected and self._client:
            try:
                await self._client.delete(key)
            except Exception as e:
                logger.error("Redis del error: %s", e)
        self._memory_kv.pop(key, None)

    # --- Latest Vehicle Telemetry Hot Cache ---
    async def set_latest_vehicle_location(
        self,
        vehicle_id: str,
        lat: float,
        lng: float,
        speed: float,
        heading: float,
        timestamp: str
    ):
        data = {
            "vehicle_id": vehicle_id,
            "latitude": lat,
            "longitude": lng,
            "speed": speed,
            "heading": heading,
            "timestamp": timestamp
        }
        key = f"vehicle:{vehicle_id}:latest"
        json_str = json.dumps(data)

        if self._is_connected and self._client:
            try:
                await self._client.set(key, json_str, ex=86400)
                return
            except Exception as e:
                logger.error("Redis set location error: %s", e)
        self._memory_kv[key] = json_str

    async def set_vehicle_location(self, vehicle_id: str, loc_data: Dict[str, Any]):
        """Convenience method accepting dictionary payload."""
        return await self.set_latest_vehicle_location(
            vehicle_id=vehicle_id,
            lat=float(loc_data.get("latitude", 0.0)),
            lng=float(loc_data.get("longitude", 0.0)),
            speed=float(loc_data.get("speed", 0.0) or 0.0),
            heading=float(loc_data.get("heading", 0.0) or 0.0),
            timestamp=str(loc_data.get("timestamp", "")),
        )

    async def get_latest_vehicle_location(self, vehicle_id: str) -> Optional[Dict[str, Any]]:
        key = f"vehicle:{vehicle_id}:latest"
        if self._is_connected and self._client:
            try:
                raw = await self._client.get(key)
                if raw:
                    return json.loads(raw)
            except Exception as e:
                logger.error("Redis get location error: %s", e)
        val = self._memory_kv.get(key)
        return json.loads(val) if val else None

    async def delete_latest_vehicle_location(self, vehicle_id: str) -> bool:
        key = f"vehicle:{vehicle_id}:latest"
        deleted = False
        if self._is_connected and self._client:
            try:
                res = await self._client.delete(key)
                deleted = bool(res)
            except Exception as e:
                logger.error("Redis delete location error: %s", e)
        if key in self._memory_kv:
            del self._memory_kv[key]
            deleted = True
        return deleted

    # --- Real-Time Pub/Sub Telemetry Distribution ---
    async def publish_location_update(self, journey_id: str, payload: Dict[str, Any]):
        channel = f"channel:journey:{journey_id}"
        message_str = json.dumps(payload)

        if self._is_connected and self._client:
            try:
                await self._client.publish(channel, message_str)
                # Also publish to fleet channel for company console
                await self._client.publish("channel:fleet:broadcast", message_str)
                return
            except Exception as e:
                logger.error("Redis publish error: %s", e)

        # In-memory publish
        await self._memory_pubsub.publish(channel, message_str)
        await self._memory_pubsub.publish("channel:fleet:broadcast", message_str)

    def subscribe_in_memory(self, channel: str) -> asyncio.Queue:
        return self._memory_pubsub.subscribe(channel)

    def unsubscribe_in_memory(self, channel: str, q: asyncio.Queue):
        self._memory_pubsub.unsubscribe(channel, q)


# Global singleton instance
redis_service = RedisService()


def get_redis_service() -> RedisService:
    return redis_service
