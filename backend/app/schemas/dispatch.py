"""Pydantic schemas for driver availability, dispatching, and delivery assignments."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


class DriverAvailabilityUpdate(BaseModel):
    availability: str = Field(..., pattern="^(AVAILABLE|UNAVAILABLE)$")


class DriverAvailabilityResponse(BaseModel):
    driver_id: str
    driver_name: str
    availability: str  # AVAILABLE | UNAVAILABLE | BUSY
    availability_preference: str
    availability_updated_at: datetime

    model_config = {"from_attributes": True}


class DeliveryAssignmentCreate(BaseModel):
    driver_id: str
    destination_name: str
    destination_lat: float = Field(..., ge=-90.0, le=90.0)
    destination_lng: float = Field(..., ge=-180.0, le=180.0)
    instructions: Optional[str] = None


class DeliveryAssignmentResponse(BaseModel):
    id: str
    company_id: str
    manager_id: str
    manager_name: Optional[str] = None
    driver_id: str
    driver_name: Optional[str] = None
    destination_name: str
    destination_lat: float
    destination_lng: float
    instructions: Optional[str] = None
    status: str  # PENDING | ACCEPTED | REJECTED | IN_PROGRESS | COMPLETED | CANCELLED
    journey_id: Optional[str] = None
    created_at: datetime
    accepted_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    tracking_url: Optional[str] = None

    model_config = {"from_attributes": True}


class DispatchDriverItem(BaseModel):
    id: str
    name: str
    email: str
    role: str
    availability: str  # AVAILABLE | UNAVAILABLE | BUSY
    availability_preference: str
    availability_updated_at: Optional[datetime] = None
    assigned_vehicle_reg: Optional[str] = None
    assigned_vehicle_model: Optional[str] = None
    can_assign: bool
    current_assignment: Optional[DeliveryAssignmentResponse] = None

    model_config = {"from_attributes": True}


class DeliveryStartRequest(BaseModel):
    vehicle_id: Optional[str] = None
    origin_name: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None


class DeliveryStartResponse(BaseModel):
    assignment: DeliveryAssignmentResponse
    journey_id: str
    tracking_url: str
    tracking_token: str
