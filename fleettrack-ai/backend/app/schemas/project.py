import uuid
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    status: str = Field(default="active", pattern="^(planning|active|completed|on_hold)$")
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_manager_id: Optional[uuid.UUID] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    status: Optional[str] = Field(None, pattern="^(planning|active|completed|on_hold)$")
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_manager_id: Optional[uuid.UUID] = None


class ProjectResponse(ProjectBase):
    id: uuid.UUID
    created_at: datetime
    manager_name: Optional[str] = None
    vehicle_count: int = 0

    model_config = ConfigDict(from_attributes=True)
