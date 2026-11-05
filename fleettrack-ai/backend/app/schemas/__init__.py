"""Pydantic schemas package for FleetTrack AI."""

from app.schemas.auth import LoginRequest, TokenResponse, TokenPayload
from app.schemas.user import UserCreate, UserUpdate, UserResponse
from app.schemas.vehicle import VehicleCreate, VehicleUpdate, VehicleResponse, VehicleLatestLocationSchema
from app.schemas.location import LocationIngestRequest, LocationRecordResponse, LocationIngestResponse
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.schemas.geofence import GeofenceCreate, GeofenceUpdate, GeofenceResponse, GeofenceEventResponse
from app.schemas.analytics import FleetSummaryResponse, VehicleActivityResponse, DailyDistanceResponse
from app.schemas.notification import NotificationResponse, NotificationUpdate
from app.schemas.ai import AIChatRequest, AIChatResponse, AIInsightResponse, ToolCallRecord

__all__ = [
    "LoginRequest",
    "TokenResponse",
    "TokenPayload",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "VehicleCreate",
    "VehicleUpdate",
    "VehicleResponse",
    "VehicleLatestLocationSchema",
    "LocationIngestRequest",
    "LocationRecordResponse",
    "LocationIngestResponse",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectResponse",
    "GeofenceCreate",
    "GeofenceUpdate",
    "GeofenceResponse",
    "GeofenceEventResponse",
    "FleetSummaryResponse",
    "VehicleActivityResponse",
    "DailyDistanceResponse",
    "NotificationResponse",
    "NotificationUpdate",
    "AIChatRequest",
    "AIChatResponse",
    "AIInsightResponse",
    "ToolCallRecord",
]
