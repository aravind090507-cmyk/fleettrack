"""Pydantic schemas for journey lifecycle management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field, model_validator


class JourneyStartRequest(BaseModel):
    vehicle_id: Optional[str] = None
    vehicle_registration: Optional[str] = None
    vehicle_model: Optional[str] = "Fleet Vehicle"
    vehicle_type: Optional[str] = "VAN"
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    origin_name: str = Field(..., min_length=1)
    origin_lat: float = Field(..., ge=-90.0, le=90.0)
    origin_lng: float = Field(..., ge=-180.0, le=180.0)
    destination_name: str = Field(..., min_length=1)
    destination_lat: float = Field(..., ge=-90.0, le=90.0)
    destination_lng: float = Field(..., ge=-180.0, le=180.0)
    description: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_location_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # 1. Normalize Source / Origin Name
            if not data.get("origin_name"):
                data["origin_name"] = (
                    data.get("source")
                    or data.get("source_name")
                    or data.get("start_location")
                    or data.get("pickup_location")
                    or data.get("origin")
                )
            # 2. Normalize Source / Origin Coordinates
            if data.get("origin_lat") is None:
                data["origin_lat"] = data.get("source_lat") or data.get("start_lat") or data.get("pickup_lat")
            if data.get("origin_lng") is None:
                data["origin_lng"] = data.get("source_lng") or data.get("start_lng") or data.get("pickup_lng")

            # 3. Normalize Destination / Ending Name
            if not data.get("destination_name"):
                data["destination_name"] = (
                    data.get("destination")
                    or data.get("dest_name")
                    or data.get("end_location")
                    or data.get("dropoff_location")
                    or data.get("target_location")
                )
            # 4. Normalize Destination Coordinates
            if data.get("destination_lat") is None:
                data["destination_lat"] = (
                    data.get("dest_lat") or data.get("end_lat") or data.get("dropoff_lat")
                )
            if data.get("destination_lng") is None:
                data["destination_lng"] = (
                    data.get("dest_lng") or data.get("end_lng") or data.get("dropoff_lng")
                )
        return data


class JourneyStartResponse(BaseModel):
    journey_id: str
    vehicle_id: str
    driver_id: str
    tracking_token: str
    tracking_url: str
    status: str
    started_at: datetime
    vehicle_registration: str
    driver_name: Optional[str] = None
    origin_name: str
    origin_lat: float
    origin_lng: float
    destination_name: str
    destination_lat: float
    destination_lng: float
    description: Optional[str] = None
    source: Optional[str] = None
    start_location: Optional[str] = None
    end_location: Optional[str] = None

    @model_validator(mode="after")
    def populate_aliases(self) -> JourneyStartResponse:
        self.source = self.origin_name
        self.start_location = self.origin_name
        self.end_location = self.destination_name
        return self


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
    tracking_token: Optional[str] = None
    tracking_url: Optional[str] = None
    source: Optional[str] = None
    start_location: Optional[str] = None
    end_location: Optional[str] = None

    @model_validator(mode="after")
    def populate_aliases(self) -> JourneyResponse:
        self.source = self.origin_name
        self.start_location = self.origin_name
        self.end_location = self.destination_name
        return self

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
