"""SQLAlchemy models package for FleetTrack AI."""

from app.database.session import Base
from app.models.user import User
from app.models.project import Project
from app.models.gps_device import GPSDevice
from app.models.vehicle import Vehicle
from app.models.location import VehicleLocation, VehicleLatestLocation
from app.models.geofence import Geofence, GeofenceEvent
from app.models.notification import Notification
from app.models.vehicle_event import VehicleEvent
from app.models.ai_insight import AIInsight

__all__ = [
    "Base",
    "User",
    "Project",
    "GPSDevice",
    "Vehicle",
    "VehicleLocation",
    "VehicleLatestLocation",
    "Geofence",
    "GeofenceEvent",
    "Notification",
    "VehicleEvent",
    "AIInsight",
]
