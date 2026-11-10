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
  vehicle_id?: string;
  vehicle_registration: string;
  vehicle_type: string;
  driver_id?: string;
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
  eta_minutes?: number | null;
  distance_remaining_km?: number | null;
  latest_event_type?: string | null;
  latest_event_at?: string | null;
  latest_event_note?: string | null;
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
  origin_name?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_name?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
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
  type: 'LOCATION_UPDATE' | 'JOURNEY_STARTED' | 'JOURNEY_COMPLETED' | 'INITIAL_STATE' | 'VEHICLE_MOVED' | 'JOURNEY_FINISHED' | 'TRIP_EVENT' | 'FLEET_STREAM_CONNECTED' | 'ENVELOPE' | 'DEVICE_STATUS';
  [key: string]: any;
}

export interface Device {
  id: string;
  unique_id: string;
  name: string;
  status: 'online' | 'unknown' | 'offline';
  disabled: boolean;
  last_update: string | null;
  position_id: number | null;
  phone?: string | null;
  model?: string | null;
  contact?: string | null;
  category?: string | null;
  attributes: Record<string, any>;
  company_id?: string;
  vehicle_id?: string | null;
  vehicle?: Vehicle | null;
}

export interface DeviceDiagnostics {
  device_id: string;
  unique_id: string;
  name: string;
  status: string;
  last_update: string | null;
  rejection_counters: Record<string, number>;
  last_rejected_points: Array<{
    reason: string;
    latitude: number;
    longitude: number;
    device_time: string;
    server_time: string;
    attributes?: Record<string, any>;
  }>;
  clock_skew_ms: number;
  ingest_lag_ms: number;
}

export interface Position {
  id: number;
  device_id: string;
  journey_id?: string | null;
  protocol: string;
  server_time: string;
  device_time: string;
  fix_time: string;
  valid: boolean;
  outdated: boolean;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  speed: number;
  course: number;
  address?: string | null;
  accuracy: number;
  distance_m: number;
  total_distance_m: number;
  motion: boolean;
  geofence_ids: string[];
  attributes: Record<string, any>;
}

export interface TelematicsEvent {
  id: string;
  type: string;
  event_time: string;
  device_id: string;
  journey_id?: string | null;
  position_id?: number | null;
  geofence_id?: string | null;
  attributes: Record<string, any>;
}

export interface Geofence {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  area: string;
  attributes: Record<string, any>;
  created_at: string;
  device_ids?: string[];
}

export interface TripReportItem {
  device_id: string;
  start_time: string;
  start_position_id?: number | null;
  start_lat: number;
  start_lng: number;
  start_address?: string | null;
  end_time: string;
  end_position_id?: number | null;
  end_lat: number;
  end_lng: number;
  end_address?: string | null;
  distance_km: number;
  duration_seconds: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
}

export interface StopReportItem {
  device_id: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  position_id?: number | null;
  latitude: number;
  longitude: number;
  address?: string | null;
  spent_fuel: number;
}

export interface SummaryReportItem {
  device_id: string;
  device_name: string;
  start_time: string;
  end_time: string;
  distance_km: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  engine_hours: number;
  spent_fuel: number;
  moving_duration_seconds: number;
  stop_duration_seconds: number;
  position_count: number;
}

export interface TelematicsEnvelope {
  type: 'ENVELOPE';
  devices?: Device[];
  positions?: Position[];
  events?: TelematicsEvent[];
  server_time?: string;
}
