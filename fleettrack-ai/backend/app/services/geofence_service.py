import math
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.geofence import Geofence, GeofenceEvent
from app.models.vehicle import Vehicle
from app.models.vehicle_event import VehicleEvent
from app.models.notification import Notification
from app.repositories.geofence_repo import GeofenceRepository
from app.websocket.manager import ws_manager

logger = logging.getLogger("fleettrack.geofence_service")


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two coordinates using Haversine formula."""
    R = 6371000  # meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def point_in_polygon(lat: float, lon: float, polygon: list) -> bool:
    """
    Ray-casting algorithm to determine if a point is inside a polygon.
    polygon is a list of [lat, lon] or {'lat': ..., 'lng': ...}
    """
    if not polygon or len(polygon) < 3:
        return False

    coords = []
    for p in polygon:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            coords.append((float(p[0]), float(p[1])))
        elif isinstance(p, dict):
            coords.append((float(p.get("lat", 0)), float(p.get("lng", p.get("lon", 0)))))

    n = len(coords)
    inside = False
    p1x, p1y = coords[0]
    for i in range(n + 1):
        p2x, p2y = coords[i % n]
        if lat > min(p1x, p2x):
            if lat <= max(p1x, p2x):
                if lon <= max(p1y, p2y):
                    if p1x != p2x:
                        xinters = (lat - p1x) * (p2x - p1x) / (p2y - p1y if p2y != p1y else 1e-9) + p1x
                    if p1y == p2y or lon <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


class GeofenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_vehicle_geofences(
        self,
        vehicle_id: uuid.UUID,
        latitude: float,
        longitude: float,
    ) -> None:
        """
        Check if a vehicle is inside/outside active geofences and generate entry/exit events.
        Includes debouncing against immediate duplicate events.
        """
        try:
            # 1. Fetch active geofences
            geofences = await GeofenceRepository.list_geofences(self.db, active_only=True)
            if not geofences:
                return

            # 2. Get vehicle details
            veh_res = await self.db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
            vehicle = veh_res.scalar_one_or_none()
            if not vehicle:
                return

            for gf in geofences:
                is_inside = False
                if gf.geofence_type == "circle":
                    if gf.center_latitude is not None and gf.center_longitude is not None and gf.radius_meters:
                        dist = haversine_distance(latitude, longitude, gf.center_latitude, gf.center_longitude)
                        is_inside = dist <= gf.radius_meters
                elif gf.geofence_type == "polygon":
                    if gf.polygon_coordinates:
                        is_inside = point_in_polygon(latitude, longitude, gf.polygon_coordinates)

                # Fetch last event for this vehicle & geofence to avoid duplicate alerts
                last_event = await GeofenceRepository.get_last_event_for_vehicle(self.db, vehicle_id, gf.id)
                last_status = last_event.event_type if last_event else "exited"

                event_to_record: Optional[str] = None
                if is_inside and last_status == "exited":
                    event_to_record = "entered"
                elif not is_inside and last_status == "entered":
                    event_to_record = "exited"

                if event_to_record:
                    # Record geofence event
                    gf_event = await GeofenceRepository.record_event(
                        db=self.db,
                        vehicle_id=vehicle_id,
                        geofence_id=gf.id,
                        event_type=event_to_record,
                        latitude=latitude,
                        longitude=longitude,
                    )

                    # Record vehicle event for activity stream
                    veh_event = VehicleEvent(
                        vehicle_id=vehicle_id,
                        event_type=f"geofence_{event_to_record}",
                        description=f"Vehicle {vehicle.registration_number} {event_to_record} geofence '{gf.name}'",
                        event_metadata={"geofence_id": str(gf.id), "geofence_name": gf.name},
                    )
                    self.db.add(veh_event)

                    # Notify manager or admin
                    msg_text = f"Vehicle {vehicle.registration_number} {event_to_record} geofence '{gf.name}'"
                    notification = Notification(
                        user_id=vehicle.assigned_manager_id or None,
                        vehicle_id=vehicle_id,
                        event_type=f"geofence_{event_to_record}",
                        message=msg_text,
                    )
                    if vehicle.assigned_manager_id:
                        self.db.add(notification)

                    await self.db.commit()

                    # Real-time WebSocket notification broadcast
                    if vehicle.assigned_manager_id:
                        await ws_manager.send_notification(
                            str(vehicle.assigned_manager_id),
                            {
                                "id": str(notification.id),
                                "event_type": f"geofence_{event_to_record}",
                                "message": msg_text,
                                "vehicle_id": str(vehicle_id),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            },
                        )

        except Exception as e:
            logger.error(f"Error checking geofences for vehicle {vehicle_id}: {e}", exc_info=True)
            await self.db.rollback()
