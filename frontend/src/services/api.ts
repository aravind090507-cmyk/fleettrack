import axios from 'axios';
import {
  ActiveJourneyTelemetry,
  ActiveVehicleTelemetry,
  DashboardOverview,
  DeliveryAssignment,
  Device,
  DeviceDiagnostics,
  DispatchDriverItem,
  DriverAvailabilityResponse,
  Geofence,
  Journey,
  LatestLocation,
  LocationPing,
  Position,
  PublicTripEvent,
  TelematicsEvent,
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
  const envUrl = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ''
  ).replace(/\/$/, '');
  if (envUrl) return envUrl;

  // Direct connection to Railway production backend when hosted on Vercel
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://fleettrack-production-d254.up.railway.app';
  }

  return '';
};

const api = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true', // Bypasses localtunnel splash screen if used
  },
});

export const getActiveTokenForRequest = (url?: string): string | null => {
  if (typeof window === 'undefined') return null;

  // 1. Explicit Driver endpoints always prioritize Driver session
  if (url && (url.startsWith('/api/driver') || url.includes('/driver/'))) {
    const driverToken = localStorage.getItem('fleet_driver_token');
    if (driverToken) return driverToken;
  }

  // 2. Explicit Manager endpoints always prioritize Manager session
  if (
    url &&
    (url.startsWith('/api/dispatch') ||
      url.startsWith('/api/dashboard') ||
      url.startsWith('/api/vehicles') ||
      url.startsWith('/api/geofences'))
  ) {
    const managerToken = localStorage.getItem('fleet_manager_token');
    if (managerToken) return managerToken;
  }

  // 3. Resolve by active route pathname
  const pathname = window.location.pathname;
  if (pathname.startsWith('/driver')) {
    return localStorage.getItem('fleet_driver_token') || localStorage.getItem('fleet_token');
  }
  if (pathname.startsWith('/company') || pathname.startsWith('/dashboard')) {
    return localStorage.getItem('fleet_manager_token') || localStorage.getItem('fleet_token');
  }

  // 4. Resolve by tab-isolated session storage
  try {
    const tabRole = sessionStorage.getItem('fleet_tab_role');
    if (tabRole === 'DRIVER') {
      return localStorage.getItem('fleet_driver_token') || localStorage.getItem('fleet_token');
    }
    if (tabRole === 'FLEET_MANAGER') {
      return localStorage.getItem('fleet_manager_token') || localStorage.getItem('fleet_token');
    }
  } catch {}

  // 5. General fallback
  return (
    localStorage.getItem('fleet_manager_token') ||
    localStorage.getItem('fleet_driver_token') ||
    localStorage.getItem('fleet_token')
  );
};

// Dynamically attach baseURL & Authorization Bearer token to requests
api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  const token = getActiveTokenForRequest(config.url);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle session expiration with portal isolation
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const reqUrl = error.config?.url || '';
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

      if (reqUrl.startsWith('/api/driver') || pathname.startsWith('/driver')) {
        // Clear driver session only
        localStorage.removeItem('fleet_driver_token');
        localStorage.removeItem('fleet_driver_user');
        try {
          if (sessionStorage.getItem('fleet_tab_role') === 'DRIVER') {
            sessionStorage.removeItem('fleet_tab_role');
          }
        } catch {}
        if (!pathname.startsWith('/login') && !pathname.startsWith('/track')) {
          window.location.href = '/login';
        }
      } else if (
        reqUrl.startsWith('/api/dispatch') ||
        reqUrl.startsWith('/api/dashboard') ||
        pathname.startsWith('/company') ||
        pathname.startsWith('/dashboard')
      ) {
        // Clear manager session only
        localStorage.removeItem('fleet_manager_token');
        localStorage.removeItem('fleet_manager_user');
        try {
          if (sessionStorage.getItem('fleet_tab_role') === 'FLEET_MANAGER') {
            sessionStorage.removeItem('fleet_tab_role');
          }
        } catch {}
        if (!pathname.startsWith('/login') && !pathname.startsWith('/track')) {
          window.location.href = '/login';
        }
      } else {
        localStorage.removeItem('fleet_token');
        localStorage.removeItem('fleet_user');
        if (!pathname.startsWith('/login') && !pathname.startsWith('/track')) {
          window.location.href = '/login';
        }
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
  createUser: async (name: string, email: string, password: string, role = 'DRIVER') => {
    const { data } = await api.post('/api/auth/create-user', { name, email, password, role });
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
  getById: async (id: string) => {
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
  reverseGeocode: async (lat: number, lon: number) => {
    const { data } = await api.get(`/api/locations/reverse?lat=${lat}&lon=${lon}`);
    return data as { display_name: string; lat: number; lon: number; address: Record<string, any> };
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
  getEvents: async (token: string) => {
    const { data } = await api.get(`/api/track/${token}/events`);
    return data as PublicTripEvent[];
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
  dismissEvent: async (id: string) => {
    await api.post(`/api/dashboard/events/${id}/dismiss`);
  },
};

// --- Positions Endpoints ---
export const positionsApi = {
  list: async (params?: { vehicle_id?: string; journey_id?: string; device_id?: string; from?: string; to?: string; cursor?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.vehicle_id) query.append('vehicle_id', params.vehicle_id);
    if (params?.journey_id) query.append('journey_id', params.journey_id);
    if (params?.device_id) query.append('vehicle_id', params.device_id);
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
  list: async (params?: { vehicle_id?: string; journey_id?: string; device_id?: string; type?: string; from?: string; to?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.vehicle_id) query.append('vehicle_id', params.vehicle_id);
    if (params?.journey_id) query.append('journey_id', params.journey_id);
    if (params?.device_id) query.append('vehicle_id', params.device_id);
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
  create: async (geofence: {
    name: string;
    description?: string;
    kind?: string;
    geometry?: any;
    area?: string;
    attributes?: Record<string, any>;
  }) => {
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
};

// --- Health Endpoint ---
export const healthApi = {
  check: async () => {
    try {
      const { data } = await api.get('/health', { timeout: 10000 });
      return data as { status: string; database: string; redis: string };
    } catch {
      return null;
    }
  },
};

// --- Manager Dispatch & Delivery Assignment Endpoints ---
export const dispatchApi = {
  getDrivers: async () => {
    const { data } = await api.get('/api/dispatch/drivers');
    return data as DispatchDriverItem[];
  },
  createAssignment: async (payload: {
    driver_id: string;
    destination_name: string;
    destination_lat: number;
    destination_lng: number;
    instructions?: string;
  }) => {
    const { data } = await api.post('/api/dispatch/assignments', payload);
    return data as DeliveryAssignment;
  },
  getAssignments: async (status?: string) => {
    const url = status ? `/api/dispatch/assignments?status=${encodeURIComponent(status)}` : '/api/dispatch/assignments';
    const { data } = await api.get(url);
    return data as DeliveryAssignment[];
  },
  getAssignment: async (assignmentId: string) => {
    const { data } = await api.get(`/api/dispatch/assignments/${assignmentId}`);
    return data as DeliveryAssignment;
  },
  cancelAssignment: async (assignmentId: string) => {
    const { data } = await api.post(`/api/dispatch/assignments/${assignmentId}/cancel`);
    return data as DeliveryAssignment;
  },
};

// --- Driver Availability & Deliveries Endpoints ---
export const driverDispatchApi = {
  getAvailability: async () => {
    const { data } = await api.get('/api/driver/availability');
    return data as DriverAvailabilityResponse;
  },
  updateAvailability: async (availability: 'AVAILABLE' | 'UNAVAILABLE') => {
    const { data } = await api.put('/api/driver/availability', { availability });
    return data as DriverAvailabilityResponse;
  },
  getActiveAssignment: async () => {
    const { data } = await api.get('/api/driver/assignments/active');
    return data as DeliveryAssignment | null;
  },
  getAssignments: async () => {
    const { data } = await api.get('/api/driver/assignments');
    return data as DeliveryAssignment[];
  },
  listAssignments: async () => {
    const { data } = await api.get('/api/driver/assignments');
    return data as DeliveryAssignment[];
  },
  acceptAssignment: async (assignmentId: string) => {
    const { data } = await api.post(`/api/driver/assignments/${assignmentId}/accept`);
    return data as DeliveryAssignment;
  },
  rejectAssignment: async (assignmentId: string) => {
    const { data } = await api.post(`/api/driver/assignments/${assignmentId}/reject`);
    return data as DeliveryAssignment;
  },
  startDelivery: async (
    assignmentId: string,
    payload?: {
      vehicle_id?: string;
      origin_name?: string;
      origin_lat?: number;
      origin_lng?: number;
    }
  ) => {
    const { data } = await api.post(`/api/driver/assignments/${assignmentId}/start`, payload || {});
    return data as {
      assignment: DeliveryAssignment;
      journey_id: string;
      tracking_url: string;
      tracking_token: string;
    };
  },
  completeDelivery: async (assignmentId: string) => {
    const { data } = await api.post(`/api/driver/assignments/${assignmentId}/complete`);
    return data as DeliveryAssignment;
  },
};

export default api;
