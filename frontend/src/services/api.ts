import axios from 'axios';
import {
  ActiveJourneyTelemetry,
  ActiveVehicleTelemetry,
  DashboardOverview,
  Journey,
  LatestLocation,
  LocationPing,
  TrackingInfo,
  TripAlert,
  User,
  Vehicle,
} from '../types';

// Automatically clean up any stale custom URLs from localStorage to ensure native integrated routing
if (typeof window !== 'undefined') {
  localStorage.removeItem('fleet_backend_url');
}

export const getApiBaseUrl = (): string => {
  return import.meta.env.VITE_API_BASE_URL || '';
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
    vehicle_id: string;
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
      tracking_token: string;
      tracking_url: string;
      status: string;
      started_at: string;
      vehicle_registration: string;
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

export default api;
