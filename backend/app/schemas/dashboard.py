"""Pydantic schemas for company management dashboard overview and vehicle monitoring."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.schemas.location import LocationPing


class OverviewResponse(BaseModel):
    total_vehicles: int
    active_journeys: int
    completed_journeys: int
    offline_vehicles: int
    in_transit: int
    active_sos_alerts: int


class ActiveVehicleResponse(BaseModel):
    vehicle_id: str
    registration_number: str
    model: str
    vehicle_type: str
    status: str
    assigned_driver_id: Optional[str] = None
    assigned_driver_name: Optional[str] = None
    current_journey_id: Optional[str] = None
    latest_latitude: Optional[float] = None
    latest_longitude: Optional[float] = None
    latest_speed: Optional[float] = None
    latest_heading: Optional[float] = None
    latest_recorded_at: Optional[datetime] = None
    latest_event_type: Optional[str] = None


class TripAlertResponse(BaseModel):
    id: str
    journey_id: str
    vehicle_registration: Optional[str] = None
    driver_name: Optional[str] = None
    event_type: str
    latitude: float
    longitude: float
    metadata_json: dict = {}
    created_at: datetime


class ActiveJourneyResponse(BaseModel):
    journey_id: str
    vehicle_id: str
    vehicle_registration: str
    driver_id: str
    driver_name: str
    origin_name: str
    origin_lat: float = 0.0
    origin_lng: float = 0.0
    destination_name: str
    destination_lat: float = 0.0
    destination_lng: float = 0.0
    status: str
    started_at: datetime
    duration_seconds: int
    total_distance_km: float
    latest_location: Optional[LocationPing] = None
    latest_event_type: Optional[str] = None
    latest_event_at: Optional[datetime] = None
