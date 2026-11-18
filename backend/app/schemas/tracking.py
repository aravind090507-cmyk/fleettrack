"""Pydantic schemas for public ephemeral tracking link views."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, field_serializer


class LatestLocation(BaseModel):
    latitude: float
    longitude: float
    speed: float
    heading: float
    accuracy: float
    recorded_at: datetime

    @field_serializer("recorded_at", when_used="json")
    def serialize_recorded_at(self, v: Optional[datetime]) -> Optional[str]:
        if not v:
            return None
        s = v.isoformat()
        return s if s.endswith("Z") or ("+" in s[10:] or "-" in s[10:]) else f"{s}Z"


class PublicTripEvent(BaseModel):
    id: str
    event_type: str  # DEPARTURE | STOP | BREAK_START | BREAK_END | SOS | BREAKDOWN | ARRIVAL
    latitude: float
    longitude: float
    description: str
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, v: Optional[datetime]) -> Optional[str]:
        if not v:
            return None
        s = v.isoformat()
        return s if s.endswith("Z") or ("+" in s[10:] or "-" in s[10:]) else f"{s}Z"


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
    # Additive fields for enhanced public tracking interface
    ended_at: Optional[datetime] = None
    total_distance_km: Optional[float] = None
    duration_seconds: Optional[int] = None
    distance_travelled_km: Optional[float] = None
    trip_events: Optional[List[PublicTripEvent]] = None

    @field_serializer("started_at", "latest_event_at", "ended_at", check_fields=False, when_used="json")
    def serialize_utc_dt(self, v: Optional[datetime]) -> Optional[str]:
        if not v:
            return None
        s = v.isoformat()
        return s if s.endswith("Z") or ("+" in s[10:] or "-" in s[10:]) else f"{s}Z"


class TrackingLocationResponse(BaseModel):
    journey_id: str
    status: str
    latest_location: Optional[LatestLocation] = None
    is_active: bool
