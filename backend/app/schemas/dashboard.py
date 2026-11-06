"""Pydantic schemas for company management dashboard overview and vehicle monitoring."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, model_validator
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
    origin_name: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    destination_name: Optional[str] = None
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    source: Optional[str] = None
    start_location: Optional[str] = None
    end_location: Optional[str] = None

    @model_validator(mode="after")
    def populate_aliases(self) -> ActiveVehicleResponse:
        self.source = self.origin_name
        self.start_location = self.origin_name
        self.end_location = self.destination_name
        return self


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
    source: Optional[str] = None
    start_location: Optional[str] = None
    end_location: Optional[str] = None

    @model_validator(mode="after")
    def populate_aliases(self) -> ActiveJourneyResponse:
        self.source = self.origin_name
        self.start_location = self.origin_name
        self.end_location = self.destination_name
        return self
