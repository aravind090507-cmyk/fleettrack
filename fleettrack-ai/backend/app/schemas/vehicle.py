import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class VehicleBase(BaseModel):
    registration_number: str = Field(..., min_length=2, max_length=50)
    vehicle_type: str = Field(..., pattern="^(dump_truck|excavator|concrete_mixer|loader|crane_truck)$")
    status: str = Field(default="idle", pattern="^(active|idle|moving|offline|maintenance)$")
    device_id: Optional[uuid.UUID] = None
    assigned_manager_id: Optional[uuid.UUID] = None
    assigned_project_id: Optional[uuid.UUID] = None
    is_active: bool = True


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    registration_number: Optional[str] = Field(None, min_length=2, max_length=50)
    vehicle_type: Optional[str] = Field(None, pattern="^(dump_truck|excavator|concrete_mixer|loader|crane_truck)$")
    status: Optional[str] = Field(None, pattern="^(active|idle|moving|offline|maintenance)$")
    device_id: Optional[uuid.UUID] = None
    assigned_manager_id: Optional[uuid.UUID] = None
    assigned_project_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class VehicleLatestLocationSchema(BaseModel):
    latitude: float
    longitude: float
    speed: float
    heading: float
    recorded_at: datetime
    is_simulated: bool

    model_config = ConfigDict(from_attributes=True)


class VehicleResponse(VehicleBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    latest_location: Optional[VehicleLatestLocationSchema] = None
    manager_name: Optional[str] = None
    project_name: Optional[str] = None
    device_identifier: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
