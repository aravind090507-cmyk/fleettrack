import axios from 'axios';
import {
  ActiveJourneyTelemetry,
  ActiveVehicleTelemetry,
  DashboardOverview,
  Device,
  DeviceDiagnostics,
  Geofence,
  Journey,
  LatestLocation,
  LocationPing,
  Position,
  StopReportItem,
  SummaryReportItem,
  TelematicsEvent,
  TrackingInfo,
  TripAlert,
  TripReportItem,
  User,
  Vehicle,
} from '../types';

// Automatically clean up any stale custom URLs from localStorage to ensure native integrated routing
if (typeof window !== 'undefined') {
  localStorage.removeItem('fleet_backend_url');
}

export const getApiBaseUrl = (): string => {
  const envUrl = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ''
  ).replace(/\/$/, '');
  return envUrl;
};

const api = axios.create({
  headers: {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true', // Bypasses localtunnel splash screen if used
  },
});

// Dynamically attach baseURL & Authorization Bearer token to requests
api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = localStorage.getItem('fleet_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle session expiration
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('fleet_token');
      localStorage.removeItem('fleet_user');
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/track')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// --- Auth Endpoints ---
export const authApi = {
  login: async (email: string, password: string) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    return data as { access_token: string; token_type: string; user: User };
  },
  register: async (name: string, email: string, password: string, role = 'DRIVER') => {
    const { data } = await api.post('/api/auth/register', { name, email, password, role });
    return data as { access_token: string; token_type: string; user: User };
  },
  logout: async () => {
    const { data } = await api.post('/api/auth/logout');
    return data;
  },
  getMe: async () => {
    const { data } = await api.get('/api/auth/me');
    return data as User;
  },
};

// --- Vehicles Endpoints ---
export const vehiclesApi = {
  list: async (status?: string, type?: string) => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (type) params.append('vehicle_type', type);
    const { data } = await api.get(`/api/vehicles?${params.toString()}`);
    return data as { items: Vehicle[]; total: number };
  },
  get: async (id: string) => {
    const { data } = await api.get(`/api/vehicles/${id}`);
    return data as Vehicle;
  },
  create: async (vehicleData: Partial<Vehicle>) => {
    const { data } = await api.post('/api/vehicles', vehicleData);
    return data as Vehicle;
  },
  update: async (id: string, vehicleData: Partial<Vehicle>) => {
    const { data } = await api.put(`/api/vehicles/${id}`, vehicleData);
    return data as Vehicle;
  },
  delete: async (id: string) => {
    await api.delete(`/api/vehicles/${id}`);
  },
};

// --- Journeys Endpoints ---
export const journeysApi = {
  start: async (journeyData: {
    vehicle_id?: string;
    vehicle_registration?: string;
    vehicle_model?: string;
    vehicle_type?: string;
    origin_name: string;
    origin_lat: number;
    origin_lng: number;
    destination_name: string;
    destination_lat: number;
    destination_lng: number;
    description?: string;
  }) => {
    const { data } = await api.post('/api/journeys/start', journeyData);
    return data as {
      journey_id: string;
      vehicle_id: string;
      driver_id: string;
      tracking_token: string;
      tracking_url: string;
      status: string;
      started_at: string;
      vehicle_registration: string;
      driver_name?: string;
      origin_name: string;
      origin_lat: number;
      origin_lng: number;
      destination_name: string;
      destination_lat: number;
      destination_lng: number;
      description?: string;
    };
  },
  getActive: async () => {
    const { data } = await api.get('/api/journeys/active');
    return data as Journey[];
  },
  getHistory: async (skip = 0, limit = 20) => {
    const { data } = await api.get(`/api/journeys/history?skip=${skip}&limit=${limit}`);
    return data as Journey[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/api/journeys/${id}`);
    return data as Journey;
  },
  end: async (journeyId: string) => {
    const { data } = await api.post(`/api/journeys/${journeyId}/end`);
    return data as {
      journey_id: string;
      status: string;
      ended_at: string;
      duration_seconds: number;
      total_distance_km: number;
    };
  },
  revokeTrackingLink: async (journeyId: string) => {
    const { data } = await api.post(`/api/journeys/${journeyId}/tracking-link/revoke`);
    return data;
  },
  recordEvent: async (
    journeyId: string,
    eventData: { event_type: string; latitude: number; longitude: number; metadata?: any }
  ) => {
    const { data } = await api.post(`/api/journeys/${journeyId}/event`, eventData);
    return data;
  },
};

// --- Location Endpoints ---
export const locationApi = {
  uploadPing: async (journeyId: string, ping: LocationPing) => {
    const { data } = await api.post(`/api/journeys/${journeyId}/location`, ping);
    return data;
  },
  uploadBatch: async (journeyId: string, pings: LocationPing[]) => {
    const { data } = await api.post(`/api/journeys/${journeyId}/location/batch`, { pings });
    return data as { status: string; pings_processed: number };
  },
  getHistory: async (journeyId: string) => {
    const { data } = await api.get(`/api/journeys/${journeyId}/location?limit=2000`);
    return data as LocationPing[];
  },
  searchPlaces: async (query: string) => {
    const { data } = await api.get(`/api/locations/search?q=${encodeURIComponent(query)}`);
    return data as { display_name: string; lat: number; lon: number; type: string }[];
  },
};

// --- Tracking Endpoints (Public) ---
export const trackingApi = {
  getInfo: async (token: string) => {
    const { data } = await api.get(`/api/track/${token}`);
    return data as TrackingInfo;
  },
  getLatestLocation: async (token: string) => {
    const { data } = await api.get(`/api/track/${token}/location`);
    return data as { journey_id: string; status: string; latest_location: LatestLocation | null; is_active: boolean };
  },
  getTrail: async (token: string) => {
    const { data } = await api.get(`/api/track/${token}/trail`);
    return data as LatestLocation[];
  },
};

// --- Company Dashboard Endpoints ---
export const dashboardApi = {
  getOverview: async () => {
    const { data } = await api.get('/api/dashboard/overview');
    return data as DashboardOverview;
  },
  getActiveVehicles: async () => {
    const { data } = await api.get('/api/dashboard/active-vehicles');
    return data as ActiveVehicleTelemetry[];
  },
  getActiveJourneys: async () => {
    const { data } = await api.get('/api/dashboard/active-journeys');
    return data as ActiveJourneyTelemetry[];
  },
  getRecentEvents: async (limit = 20) => {
    const { data } = await api.get(`/api/dashboard/events?limit=${limit}`);
    return data as TripAlert[];
  },
};

// --- Devices Endpoints ---
export const devicesApi = {
  list: async () => {
    const { data } = await api.get('/api/devices');
    return data as Device[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/api/devices/${id}`);
    return data as Device;
  },
  create: async (deviceData: { unique_id: string; name: string; phone?: string; model?: string; contact?: string; category?: string; attributes?: Record<string, any> }) => {
    const { data } = await api.post('/api/devices', deviceData);
    return data as Device;
  },
  update: async (id: string, deviceData: Partial<Device>) => {
    const { data } = await api.put(`/api/devices/${id}`, deviceData);
    return data as Device;
  },
  delete: async (id: string) => {
    await api.delete(`/api/devices/${id}`);
  },
  getDiagnostics: async (id: string) => {
    const { data } = await api.get(`/api/devices/${id}/diagnostics`);
    return data as DeviceDiagnostics;
  },
};

// --- Positions Endpoints ---
export const positionsApi = {
  list: async (params?: { device_id?: string; from?: string; to?: string; cursor?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.device_id) query.append('device_id', params.device_id);
    if (params?.from) query.append('from', params.from);
    if (params?.to) query.append('to', params.to);
    if (params?.cursor !== undefined) query.append('cursor', String(params.cursor));
    if (params?.limit !== undefined) query.append('limit', String(params.limit));
    const { data } = await api.get(`/api/positions?${query.toString()}`);
    return data as { items: Position[]; next_cursor: number | null; total: number };
  },
};

// --- Events Endpoints ---
export const eventsApi = {
  list: async (params?: { device_id?: string; journey_id?: string; type?: string; from?: string; to?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.device_id) query.append('device_id', params.device_id);
    if (params?.journey_id) query.append('journey_id', params.journey_id);
    if (params?.type) query.append('type', params.type);
    if (params?.from) query.append('from', params.from);
    if (params?.to) query.append('to', params.to);
    if (params?.limit !== undefined) query.append('limit', String(params.limit));
    const { data } = await api.get(`/api/events?${query.toString()}`);
    return data as TelematicsEvent[];
  },
};

// --- Geofences Endpoints ---
export const geofencesApi = {
  list: async () => {
    const { data } = await api.get('/api/geofences');
    return data as Geofence[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/api/geofences/${id}`);
    return data as Geofence;
  },
  create: async (geofence: { name: string; description?: string; area: string; attributes?: Record<string, any> }) => {
    const { data } = await api.post('/api/geofences', geofence);
    return data as Geofence;
  },
  update: async (id: string, geofence: Partial<Geofence>) => {
    const { data } = await api.put(`/api/geofences/${id}`, geofence);
    return data as Geofence;
  },
  delete: async (id: string) => {
    await api.delete(`/api/geofences/${id}`);
  },
  linkDevices: async (id: string, deviceIds: string[]) => {
    const { data } = await api.post(`/api/geofences/${id}/devices`, { device_ids: deviceIds });
    return data;
  },
};

// --- Reports Endpoints ---
export const reportsApi = {
  getRoute: async (params: { device_id?: string; from: string; to: string; format?: 'json' | 'csv' | 'gpx' }) => {
    const query = new URLSearchParams();
    if (params.device_id) query.append('device_id', params.device_id);
    query.append('from', params.from);
    query.append('to', params.to);
    if (params.format) query.append('format', params.format);
    
    if (params.format === 'csv' || params.format === 'gpx') {
      const response = await api.get(`/api/reports/route?${query.toString()}`, { responseType: 'blob' });
      return response.data;
    }
    const { data } = await api.get(`/api/reports/route?${query.toString()}`);
    return data as Position[];
  },
  getTrips: async (params: { device_id?: string; from: string; to: string; format?: 'json' | 'csv' }) => {
    const query = new URLSearchParams();
    if (params.device_id) query.append('device_id', params.device_id);
    query.append('from', params.from);
    query.append('to', params.to);
    if (params.format) query.append('format', params.format);

    if (params.format === 'csv') {
      const response = await api.get(`/api/reports/trips?${query.toString()}`, { responseType: 'blob' });
      return response.data;
    }
    const { data } = await api.get(`/api/reports/trips?${query.toString()}`);
    return data as TripReportItem[];
  },
  getStops: async (params: { device_id?: string; from: string; to: string; format?: 'json' | 'csv' }) => {
    const query = new URLSearchParams();
    if (params.device_id) query.append('device_id', params.device_id);
    query.append('from', params.from);
    query.append('to', params.to);
    if (params.format) query.append('format', params.format);

    if (params.format === 'csv') {
      const response = await api.get(`/api/reports/stops?${query.toString()}`, { responseType: 'blob' });
      return response.data;
    }
    const { data } = await api.get(`/api/reports/stops?${query.toString()}`);
    return data as StopReportItem[];
  },
  getSummary: async (params: { device_id?: string; from: string; to: string }) => {
    const query = new URLSearchParams();
    if (params.device_id) query.append('device_id', params.device_id);
    query.append('from', params.from);
    query.append('to', params.to);
    const { data } = await api.get(`/api/reports/summary?${query.toString()}`);
    return data as SummaryReportItem[];
  },
};

// --- Health Endpoint ---
export const healthApi = {
  check: async () => {
    try {
      const { data } = await api.get('/health', { timeout: 4000 });
      return data as { status: string; database: string; redis: string };
    } catch {
      return null;
    }
  },
};

export default api;
