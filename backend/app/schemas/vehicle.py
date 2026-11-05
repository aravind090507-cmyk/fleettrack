"""Pydantic schemas for corporate vehicle assets."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class VehicleBase(BaseModel):
    registration_number: str = Field(..., min_length=2, max_length=64)
    model: str = Field(..., min_length=1, max_length=128)
    vehicle_type: str = Field(default="VAN")  # VAN | TRUCK | CAR | MOTORCYCLE
    assigned_driver_id: Optional[str] = None
    status: str = Field(default="AVAILABLE")  # AVAILABLE | IN_TRANSIT | MAINTENANCE | OFFLINE
    battery_or_fuel_level: float = Field(default=100.0, ge=0.0, le=100.0)


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    registration_number: Optional[str] = None
    model: Optional[str] = None
    vehicle_type: Optional[str] = None
    assigned_driver_id: Optional[str] = None
    status: Optional[str] = None
    battery_or_fuel_level: Optional[float] = None


class VehicleResponse(VehicleBase):
    id: str
    created_at: datetime
    updated_at: datetime
    assigned_driver_name: Optional[str] = None

    model_config = {"from_attributes": True}


class VehicleListResponse(BaseModel):
    items: List[VehicleResponse]
    total: int
