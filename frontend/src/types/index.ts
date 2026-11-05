export interface User {
  id: string;
  name: string;
  email: string;
  role: 'DRIVER' | 'FLEET_MANAGER' | 'ADMIN';
  is_active: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  registration_number: string;
  model: string;
  vehicle_type: 'VAN' | 'TRUCK' | 'CAR' | 'MOTORCYCLE';
  assigned_driver_id: string | null;
  assigned_driver_name?: string | null;
  status: 'AVAILABLE' | 'IN_TRANSIT' | 'MAINTENANCE' | 'OFFLINE';
  battery_or_fuel_level: number;
  created_at: string;
  updated_at: string;
}

export interface Journey {
  id: string;
  vehicle_id: string;
  driver_id: string;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  description?: string | null;
  total_distance_km: number;
  duration_seconds: number;
  started_at: string;
  ended_at?: string | null;
  created_at: string;
  vehicle_registration?: string;
  driver_name?: string;
}

export interface LocationPing {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  altitude?: number | null;
  timestamp: string;
}

export interface LatestLocation {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  recorded_at: string;
}

export interface TrackingInfo {
  journey_id: string;
  vehicle_registration: string;
  vehicle_type: string;
  driver_name: string;
  origin_name: string;
  destination_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  status: string;
  started_at: string;
  latest_location: LatestLocation | null;
}

export interface DashboardOverview {
  total_vehicles: number;
  active_journeys: number;
  completed_journeys: number;
  offline_vehicles: number;
  in_transit: number;
  active_sos_alerts: number;
}

export interface ActiveVehicleTelemetry {
  vehicle_id: string;
  registration_number: string;
  model: string;
  vehicle_type: string;
  status: string;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  current_journey_id: string | null;
  latest_latitude: number | null;
  latest_longitude: number | null;
  latest_speed: number | null;
  latest_heading: number | null;
  latest_recorded_at: string | null;
  latest_event_type?: string | null;
}

export interface ActiveJourneyTelemetry {
  journey_id: string;
  vehicle_id: string;
  vehicle_registration: string;
  driver_id: string;
  driver_name: string;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  status: string;
  started_at: string;
  duration_seconds: number;
  total_distance_km: number;
  latest_location: LocationPing | null;
  latest_event_type?: string | null;
  latest_event_at?: string | null;
}

export interface TripAlert {
  id: string;
  journey_id: string;
  vehicle_registration?: string | null;
  driver_name?: string | null;
  event_type: string;
  latitude: number;
  longitude: number;
  metadata_json?: Record<string, any>;
  created_at: string;
}

export interface OfflineGPSRecord {
  id?: number;
  journey_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  altitude?: number;
  timestamp: string;
  synced: boolean;
}

export interface WebSocketMessage {
  type: 'LOCATION_UPDATE' | 'JOURNEY_COMPLETED' | 'INITIAL_STATE' | 'VEHICLE_MOVED' | 'JOURNEY_FINISHED' | 'TRIP_EVENT' | 'FLEET_STREAM_CONNECTED';
  [key: string]: any;
}
