import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vehicle import Vehicle
from app.models.project import Project
from app.models.geofence import GeofenceEvent, Geofence
from app.models.location import VehicleLatestLocation, VehicleLocation
from app.models.user import User


class FleetTools:
    def __init__(self, db: AsyncSession, current_user: User):
        self.db = db
        self.current_user = current_user

    def _scope_vehicle_query(self, query):
        """Restrict query to vehicles authorized for current user."""
        if self.current_user.role != "admin":
            return query.where(Vehicle.assigned_manager_id == self.current_user.id)
        return query

    async def get_fleet_summary(self) -> Dict[str, Any]:
        """Returns counts of total, active, moving, idle, offline, and maintenance vehicles."""
        query = self._scope_vehicle_query(select(Vehicle).where(Vehicle.is_active == True))
        result = await self.db.execute(query)
        vehicles = result.scalars().all()
        return {
            "total_vehicles": len(vehicles),
            "active_vehicles": sum(1 for v in vehicles if v.status in ("active", "idle", "moving")),
            "moving_vehicles": sum(1 for v in vehicles if v.status == "moving"),
            "idle_vehicles": sum(1 for v in vehicles if v.status == "idle"),
            "offline_vehicles": sum(1 for v in vehicles if v.status == "offline"),
            "maintenance_vehicles": sum(1 for v in vehicles if v.status == "maintenance"),
        }

    async def get_vehicle_status(self, vehicle_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns current operational status of one or all authorized vehicles."""
        query = self._scope_vehicle_query(select(Vehicle).where(Vehicle.is_active == True))
        if vehicle_id:
            try:
                v_uuid = uuid.UUID(vehicle_id)
                query = query.where(Vehicle.id == v_uuid)
            except ValueError:
                return []

        result = await self.db.execute(query)
        vehicles = result.scalars().all()

        output = []
        for v in vehicles:
            loc_res = await self.db.execute(
                select(VehicleLatestLocation).where(VehicleLatestLocation.vehicle_id == v.id)
            )
            latest = loc_res.scalar_one_or_none()
            output.append({
                "vehicle_id": str(v.id),
                "registration_number": v.registration_number,
                "vehicle_type": v.vehicle_type,
                "status": v.status,
                "speed": latest.speed if latest else 0.0,
                "heading": latest.heading if latest else 0.0,
                "last_seen": latest.recorded_at.isoformat() if latest else None,
                "is_simulated": latest.is_simulated if latest else False,
            })
        return output

    async def get_idle_vehicles(self, threshold_minutes: int = 30) -> List[Dict[str, Any]]:
        """Returns authorized vehicles that are currently in 'idle' status."""
        query = self._scope_vehicle_query(
            select(Vehicle).where(Vehicle.is_active == True, Vehicle.status == "idle")
        )
        result = await self.db.execute(query)
        vehicles = result.scalars().all()
        return [
            {
                "vehicle_id": str(v.id),
                "registration_number": v.registration_number,
                "vehicle_type": v.vehicle_type,
                "status": "idle",
            }
            for v in vehicles
        ]

    async def get_offline_vehicles(self, threshold_minutes: int = 15) -> List[Dict[str, Any]]:
        """Returns authorized vehicles that are offline or haven't reported recently."""
        query = self._scope_vehicle_query(
            select(Vehicle).where(Vehicle.is_active == True, Vehicle.status == "offline")
        )
        result = await self.db.execute(query)
        vehicles = result.scalars().all()
        return [
            {
                "vehicle_id": str(v.id),
                "registration_number": v.registration_number,
                "vehicle_type": v.vehicle_type,
                "status": "offline",
            }
            for v in vehicles
        ]

    async def get_geofence_events(self, hours: int = 24) -> List[Dict[str, Any]]:
        """Returns recent geofence entry and exit events."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        query = (
            select(GeofenceEvent, Vehicle.registration_number, Geofence.name)
            .join(Vehicle, Vehicle.id == GeofenceEvent.vehicle_id)
            .join(Geofence, Geofence.id == GeofenceEvent.geofence_id)
            .where(GeofenceEvent.occurred_at >= cutoff)
            .order_by(desc(GeofenceEvent.occurred_at))
            .limit(20)
        )
        if self.current_user.role != "admin":
            query = query.where(Vehicle.assigned_manager_id == self.current_user.id)

        result = await self.db.execute(query)
        return [
            {
                "vehicle_registration": row[1],
                "geofence_name": row[2],
                "event_type": row[0].event_type,
                "occurred_at": row[0].occurred_at.isoformat(),
            }
            for row in result.all()
        ]

    async def get_project_vehicles(self, project_id: str) -> List[Dict[str, Any]]:
        """Returns vehicles assigned to a given project."""
        try:
            p_uuid = uuid.UUID(project_id)
        except ValueError:
            return []
        query = self._scope_vehicle_query(
            select(Vehicle).where(Vehicle.is_active == True, Vehicle.assigned_project_id == p_uuid)
        )
        result = await self.db.execute(query)
        return [
            {
                "vehicle_id": str(v.id),
                "registration_number": v.registration_number,
                "vehicle_type": v.vehicle_type,
                "status": v.status,
            }
            for v in result.scalars().all()
        ]
