import uuid
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class GeofenceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    project_id: Optional[uuid.UUID] = None
    geofence_type: str = Field(default="circle", pattern="^(circle|polygon)$")
    center_latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    center_longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: Optional[float] = Field(None, ge=1.0, le=500000.0)
    polygon_coordinates: Optional[List[List[float]]] = None  # [[lat, lng], ...]
    is_active: bool = True


class GeofenceCreate(GeofenceBase):
    pass


class GeofenceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    project_id: Optional[uuid.UUID] = None
    geofence_type: Optional[str] = Field(None, pattern="^(circle|polygon)$")
    center_latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    center_longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: Optional[float] = Field(None, ge=1.0, le=500000.0)
    polygon_coordinates: Optional[List[List[float]]] = None
    is_active: Optional[bool] = None


class GeofenceResponse(GeofenceBase):
    id: uuid.UUID
    created_at: datetime
    project_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class GeofenceEventResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: Optional[str] = None
    geofence_id: uuid.UUID
    geofence_name: Optional[str] = None
    event_type: str  # 'entered', 'exited'
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    occurred_at: datetime

    model_config = ConfigDict(from_attributes=True)
