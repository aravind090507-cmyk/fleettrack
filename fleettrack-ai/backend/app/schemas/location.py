import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class LocationIngestRequest(BaseModel):
    device_id: str = Field(..., description="Device UUID or device identifier string")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed: float = Field(..., ge=0.0, le=300.0, description="Speed in km/h")
    heading: float = Field(..., ge=0.0, le=360.0, description="Heading in degrees")
    recorded_at: datetime
    device_token: str = Field(..., description="HMAC authentication token for device")
    is_simulated: bool = False


class LocationRecordResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    latitude: float
    longitude: float
    speed: float
    heading: float
    recorded_at: datetime
    received_at: datetime
    is_simulated: bool

    model_config = ConfigDict(from_attributes=True)


class LocationIngestResponse(BaseModel):
    success: bool
    message: str
    vehicle_id: Optional[uuid.UUID] = None
    status: Optional[str] = None
