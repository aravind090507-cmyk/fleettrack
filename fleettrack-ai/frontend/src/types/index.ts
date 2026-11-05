export type UserRole = 'admin' | 'fleet_manager';

export type VehicleType = 
  | 'dump_truck' 
  | 'excavator' 
  | 'concrete_mixer' 
  | 'loader' 
  | 'crane_truck';

export type VehicleStatus = 
  | 'active' 
  | 'idle' 
  | 'moving' 
  | 'offline' 
  | 'maintenance';

export type ProjectStatus = 
  | 'planning' 
  | 'active' 
  | 'completed' 
  | 'on_hold';

export type GeofenceType = 'circle' | 'polygon';

export type GeofenceEventType = 'entered' | 'exited';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  registration_number: string;
  vehicle_type: VehicleType;
  device_id: string;
  assigned_manager_id?: string | null;
  assigned_project_id?: string | null;
  status: VehicleStatus;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  manager?: User | null;
  project?: Project | null;
  latest_location?: VehicleLocation | null;
}

export interface VehicleLocation {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  recorded_at: string;
  is_simulated?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  status: ProjectStatus;
  start_date?: string;
  end_date?: string;
  assigned_manager_id?: string | null;
  created_at: string;
  manager?: User | null;
  vehicles_count?: number;
}

export interface GeofenceCoordinate {
  lat: number;
  lng: number;
}

export interface Geofence {
  id: string;
  name: string;
  project_id?: string | null;
  geofence_type: GeofenceType;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_meters?: number | null;
  polygon_coords?: GeofenceCoordinate[] | null;
  is_active: boolean;
  created_at: string;
  project?: Project | null;
}

export interface Notification {
  id: string;
  user_id: string;
  vehicle_id?: string | null;
  event_type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  vehicle?: Vehicle | null;
}

export interface FleetSummary {
  total_vehicles: number;
  active_vehicles: number;
  moving_vehicles: number;
  idle_vehicles: number;
  offline_vehicles: number;
  maintenance_vehicles: number;
}

export interface VehicleActivity {
  vehicle_id: string;
  registration_number: string;
  total_distance_km: number;
  total_time_hours: number;
  moving_time_hours: number;
  idle_time_hours: number;
  max_speed: number;
  avg_speed: number;
  date?: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  is_fallback?: boolean;
  timestamp?: string;
}

export interface AIInsight {
  id: string;
  vehicle_id?: string | null;
  insight_type: string;
  description: string;
  evidence: string;
  insight_source: string;
  created_at: string;
  vehicle?: Vehicle | null;
}

export interface RouteHistoryPoint {
  id?: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  recorded_at: string;
}

export interface RouteStats {
  duration_seconds: number;
  total_distance_km: number;
  max_speed: number;
  avg_speed: number;
  stops_count: number;
}

export interface ETAResult {
  distance_km: number;
  duration_minutes: number;
  estimated_arrival: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}

export interface SimulatorStatus {
  is_running: boolean;
  speed_multiplier: number;
  active_simulated_vehicles: number;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}
