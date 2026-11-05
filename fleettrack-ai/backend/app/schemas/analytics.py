import uuid
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class FleetSummaryResponse(BaseModel):
    total_vehicles: int
    active_vehicles: int
    moving_vehicles: int
    idle_vehicles: int
    offline_vehicles: int
    maintenance_vehicles: int


class VehicleActivityItem(BaseModel):
    vehicle_id: uuid.UUID
    registration_number: str
    vehicle_type: str
    total_distance_km: float
    total_time_hours: float
    moving_time_hours: float
    idle_time_hours: float
    max_speed: float
    avg_speed: float
    location_count: int

    model_config = ConfigDict(from_attributes=True)


class VehicleActivityResponse(BaseModel):
    items: List[VehicleActivityItem]
    total_fleet_distance_km: float
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class DailyDistanceItem(BaseModel):
    date: str  # YYYY-MM-DD
    distance_km: float
    vehicle_count: int


class DailyDistanceResponse(BaseModel):
    items: List[DailyDistanceItem]
    total_distance_km: float
