import asyncio
import logging
import math
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional
from sqlalchemy import select

from app.database.session import async_session_maker
from app.models.gps_device import GPSDevice
from app.models.vehicle import Vehicle
from app.models.location import VehicleLocation, VehicleLatestLocation
from app.repositories.location_repo import LocationRepository
from app.simulator.routes import SIMULATED_ROUTES
from app.websocket.manager import ws_manager

logger = logging.getLogger("fleettrack.simulator")


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates bearing (heading degrees 0-360) from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360


class FleetSimulator:
    def __init__(self, interval_seconds: float = 5.0):
        self.interval = interval_seconds
        self.running = False
        self.paused = False
        self.vehicles = SIMULATED_ROUTES

        # Per-vehicle simulation state: device_id -> {waypoint_idx, fraction, idle_ticks}
        self.state: Dict[str, dict] = {}
        for dev_id in self.vehicles.keys():
            self.state[dev_id] = {
                "waypoint_idx": 0,
                "fraction": 0.0,
                "idle_ticks": 0,
                "current_speed": 0.0,
            }

    def stop(self) -> None:
        self.running = False

    async def run(self) -> None:
        """Main simulation background loop."""
        self.running = True
        logger.info(f"Fleet GPS Simulator started (interval: {self.interval}s, vehicles: {len(self.vehicles)})")

        # Initial wait before starting first tick so database startup and seed finish cleanly
        await asyncio.sleep(6)

        while self.running:
            try:
                if not self.paused:
                    await self._tick()
            except Exception as e:
                logger.error(f"Simulator tick exception: {e}", exc_info=True)

            await asyncio.sleep(self.interval)

    async def _tick(self) -> None:
        now = datetime.now(timezone.utc)

        async with async_session_maker() as db:
            for device_id, config in self.vehicles.items():
                path = config["path"]
                st = self.state[device_id]
                idx = st["waypoint_idx"]
                next_idx = (idx + 1) % len(path)

                p1 = path[idx]
                p2 = path[next_idx]

                # Occasional construction/traffic pause (idle simulation)
                if st["idle_ticks"] > 0:
                    st["idle_ticks"] -= 1
                    speed = 0.0
                    status = "idle"
                    lat = p1["lat"]
                    lng = p1["lng"]
                    heading = calculate_bearing(p1["lat"], p1["lng"], p2["lat"], p2["lng"])
                else:
                    # Random chance to pause at a work site (1 in 30 ticks ~ every 2.5 minutes)
                    if random.random() < 0.03:
                        st["idle_ticks"] = random.randint(3, 8)  # idle for 15-40 seconds
                        speed = 0.0
                        status = "idle"
                        lat = p1["lat"]
                        lng = p1["lng"]
                        heading = calculate_bearing(p1["lat"], p1["lng"], p2["lat"], p2["lng"])
                    else:
                        # Advance position along line
                        step = 0.08 + random.uniform(-0.02, 0.02)
                        st["fraction"] += step
                        if st["fraction"] >= 1.0:
                            st["fraction"] = 0.0
                            st["waypoint_idx"] = next_idx
                            idx = next_idx
                            next_idx = (idx + 1) % len(path)
                            p1 = path[idx]
                            p2 = path[next_idx]

                        frac = st["fraction"]
                        lat = p1["lat"] + (p2["lat"] - p1["lat"]) * frac
                        lng = p1["lng"] + (p2["lng"] - p1["lng"]) * frac
                        heading = calculate_bearing(p1["lat"], p1["lng"], p2["lat"], p2["lng"])

                        base_spd = config.get("base_speed", 30.0)
                        speed = max(5.0, base_spd + random.uniform(-6.0, 6.0))
                        status = "moving"

                st["current_speed"] = speed

                # Look up vehicle in DB by registration
                v_res = await db.execute(
                    select(Vehicle).where(Vehicle.registration_number == config["registration_number"])
                )
                vehicle = v_res.scalar_one_or_none()
                if not vehicle:
                    continue

                # Store location record & upsert latest location
                loc_repo = LocationRepository(db)
                await loc_repo.store_location(
                    vehicle_id=vehicle.id,
                    latitude=lat,
                    longitude=lng,
                    speed=speed,
                    heading=heading,
                    recorded_at=now,
                    is_simulated=True,
                )

                # Update vehicle status
                vehicle.status = status
                await db.commit()

                # Broadcast live update via WebSocket
                ws_payload = {
                    "type": "vehicle_location",
                    "vehicle_id": str(vehicle.id),
                    "registration_number": vehicle.registration_number,
                    "vehicle_type": vehicle.vehicle_type,
                    "latitude": round(lat, 6),
                    "longitude": round(lng, 6),
                    "speed": round(speed, 1),
                    "heading": round(heading, 1),
                    "status": status,
                    "recorded_at": now.isoformat(),
                    "is_simulated": True,
                }
                await ws_manager.broadcast_location(str(vehicle.id), ws_payload)

                # Spatial geofence check
                try:
                    from app.services.geofence_service import GeofenceService
                    gf_svc = GeofenceService(db)
                    await gf_svc.check_vehicle_geofences(vehicle.id, lat, lng)
                except Exception as gf_err:
                    logger.debug(f"Geofence check notice: {gf_err}")


# Global simulator singleton
fleet_simulator = FleetSimulator(interval_seconds=5.0)
