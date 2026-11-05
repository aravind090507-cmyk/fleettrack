"""ORM Models for FleetTrack."""
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.journey import Journey
from app.models.location import Location
from app.models.tracking_link import TrackingLink
from app.models.trip_event import TripEvent

__all__ = [
    "User",
    "Vehicle",
    "Journey",
    "Location",
    "TrackingLink",
    "TripEvent",
]
