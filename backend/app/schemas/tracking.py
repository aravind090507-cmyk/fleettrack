"""Pydantic schemas for public ephemeral tracking link views."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class LatestLocation(BaseModel):
    latitude: float
    longitude: float
    speed: float
    heading: float
    accuracy: float
    recorded_at: datetime


class TrackingInfoResponse(BaseModel):
    journey_id: str
    vehicle_id: Optional[str] = None
    vehicle_registration: str
    vehicle_type: str
    driver_id: Optional[str] = None
    driver_name: str
    origin_name: str
    destination_name: str
    origin_lat: float
    origin_lng: float
    destination_lat: float
    destination_lng: float
    status: str
    started_at: datetime
    latest_location: Optional[LatestLocation] = None
    # ETA and event fields
    eta_minutes: Optional[float] = None
    distance_remaining_km: Optional[float] = None
    latest_event_type: Optional[str] = None
    latest_event_at: Optional[datetime] = None
    latest_event_note: Optional[str] = None


class TrackingLocationResponse(BaseModel):
    journey_id: str
    status: str
    latest_location: Optional[LatestLocation] = None
    is_active: bool
