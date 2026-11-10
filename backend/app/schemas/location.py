"""Pydantic schemas for GPS location telemetry."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class LocationPing(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed: float = Field(default=0.0, ge=0.0)
    heading: float = Field(default=0.0, ge=0.0, le=360.0)
    accuracy: float = Field(default=0.0, ge=0.0)
    altitude: Optional[float] = None
    timestamp: datetime


class LocationBatch(BaseModel):
    pings: List[LocationPing] = Field(..., min_length=1, max_length=1000)


class LocationResponse(BaseModel):
    id: int
    journey_id: Optional[str] = None
    device_id: Optional[str] = None
    latitude: float
    longitude: float
    speed: float
    heading: float
    accuracy: float
    altitude: Optional[float] = None
    valid: bool = True
    outdated: bool = False
    protocol: str = "web"
    recorded_at: datetime
    server_received_at: datetime

    model_config = {"from_attributes": True}


class LocationIngestResult(BaseModel):
    status: str = "recorded"
    pings_processed: int = 1
    received_at: datetime
    server_time: Optional[datetime] = None
    accepted_count: int = 1
    rejected_count: int = 0
    filtered_count: int = 0
    results: Optional[List[dict]] = None
