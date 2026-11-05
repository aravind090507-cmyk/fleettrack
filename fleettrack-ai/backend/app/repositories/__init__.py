"""Data access repositories for FleetTrack AI."""

from app.repositories.user_repo import UserRepository
from app.repositories.vehicle_repo import VehicleRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.project_repo import ProjectRepository
from app.repositories.geofence_repo import GeofenceRepository
from app.repositories.notification_repo import NotificationRepository

__all__ = [
    "UserRepository",
    "VehicleRepository",
    "LocationRepository",
    "ProjectRepository",
    "GeofenceRepository",
    "NotificationRepository",
]
