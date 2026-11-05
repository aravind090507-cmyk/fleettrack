"""Pydantic schemas for journey lifecycle management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class JourneyStartRequest(BaseModel):
    vehicle_id: Optional[str] = None
    vehicle_registration: Optional[str] = None
    vehicle_model: Optional[str] = "Fleet Vehicle"
    vehicle_type: Optional[str] = "VAN"
    origin_name: str = Field(..., min_length=1)
    origin_lat: float = Field(..., ge=-90.0, le=90.0)
    origin_lng: float = Field(..., ge=-180.0, le=180.0)
    destination_name: str = Field(..., min_length=1)
    destination_lat: float = Field(..., ge=-90.0, le=90.0)
    destination_lng: float = Field(..., ge=-180.0, le=180.0)
    description: Optional[str] = None


class JourneyStartResponse(BaseModel):
    journey_id: str
    tracking_token: str
    tracking_url: str
    status: str
    started_at: datetime
    vehicle_registration: str


class JourneyResponse(BaseModel):
    id: str
    vehicle_id: str
    driver_id: str
    origin_name: str
    origin_lat: float
    origin_lng: float
    destination_name: str
    destination_lat: float
    destination_lng: float
    status: str
    description: Optional[str] = None
    total_distance_km: float = 0.0
    duration_seconds: int = 0
    started_at: datetime
    ended_at: Optional[datetime] = None
    created_at: datetime
    vehicle_registration: Optional[str] = None
    driver_name: Optional[str] = None

    model_config = {"from_attributes": True}


class JourneyEndResponse(BaseModel):
    journey_id: str
    status: str
    ended_at: datetime
    duration_seconds: int
    total_distance_km: float
    message: str = "Journey ended successfully and tracking link revoked."


class TripEventCreate(BaseModel):
    event_type: str = Field(..., min_length=2)  # BREAK_START | BREAK_END | SOS | BREAKDOWN | STOP
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    metadata: Optional[dict] = None


class TripEventResponse(BaseModel):
    id: str
    journey_id: str
    event_type: str
    latitude: float
    longitude: float
    metadata_json: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}
