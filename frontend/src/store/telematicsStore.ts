import { create } from 'zustand';
import { Device, Geofence, Position, TelematicsEnvelope, TelematicsEvent } from '../types';

export interface SocketState {
  connected: boolean;
  connecting: boolean;
  lastConnectedAt: string | null;
  reconnectAttempts: number;
}

interface TelematicsState {
  devices: {
    byId: Record<string, Device>;
    allIds: string[];
  };
  positions: {
    byDeviceId: Record<string, Position>;
  };
  routes: Record<string, Position[]>;
  events: TelematicsEvent[];
  geofences: {
    byId: Record<string, Geofence>;
    allIds: string[];
  };
  socket: SocketState;
  selectedDeviceId: string | null;

  // Actions
  setDevices: (devices: Device[]) => void;
  updateDevice: (device: Partial<Device> & { id: string }) => void;
  setPositions: (positions: Position[]) => void;
  addPosition: (pos: Position) => void;
  addEvent: (event: TelematicsEvent) => void;
  handleEnvelope: (envelope: TelematicsEnvelope) => void;
  setGeofences: (geofences: Geofence[]) => void;
  setSocketState: (socketUpdate: Partial<SocketState>) => void;
  setSelectedDeviceId: (id: string | null) => void;
  reset: () => void;
}

const MAX_EVENTS = 100;
const MAX_ROUTE_POINTS = 50;

export const useTelematicsStore = create<TelematicsState>((set) => ({
  devices: {
    byId: {},
    allIds: [],
  },
  positions: {
    byDeviceId: {},
  },
  routes: {},
  events: [],
  geofences: {
    byId: {},
    allIds: [],
  },
  socket: {
    connected: false,
    connecting: false,
    lastConnectedAt: null,
    reconnectAttempts: 0,
  },
  selectedDeviceId: null,

  setDevices: (devicesList) =>
    set((state) => {
      const byId: Record<string, Device> = {};
      const allIds: string[] = [];
      for (const d of devicesList) {
        byId[d.id] = d;
        allIds.push(d.id);
      }
      return {
        devices: { byId, allIds },
      };
    }),

  updateDevice: (deviceUpdate) =>
    set((state) => {
      const existing = state.devices.byId[deviceUpdate.id];
      if (!existing) return state;
      const updated = { ...existing, ...deviceUpdate };
      return {
        devices: {
          ...state.devices,
          byId: {
            ...state.devices.byId,
            [deviceUpdate.id]: updated,
          },
        },
      };
    }),

  setPositions: (positionsList) =>
    set((state) => {
      const byDeviceId = { ...state.positions.byDeviceId };
      const routes = { ...state.routes };
      const devicesById = { ...state.devices.byId };

      for (const pos of positionsList) {
        byDeviceId[pos.device_id] = pos;
        const currentRoute = routes[pos.device_id] || [];
        const updatedRoute = [...currentRoute, pos].slice(-MAX_ROUTE_POINTS);
        routes[pos.device_id] = updatedRoute;

        if (devicesById[pos.device_id]) {
          devicesById[pos.device_id] = {
            ...devicesById[pos.device_id],
            position_id: pos.id,
            last_update: pos.device_time || pos.server_time || devicesById[pos.device_id].last_update,
          };
        }
      }

      return {
        positions: { byDeviceId },
        routes,
        devices: {
          ...state.devices,
          byId: devicesById,
        },
      };
    }),

  addPosition: (pos) =>
    set((state) => {
      const currentRoute = state.routes[pos.device_id] || [];
      const updatedRoute = [...currentRoute, pos].slice(-MAX_ROUTE_POINTS);
      const dev = state.devices.byId[pos.device_id];

      return {
        positions: {
          byDeviceId: {
            ...state.positions.byDeviceId,
            [pos.device_id]: pos,
          },
        },
        routes: {
          ...state.routes,
          [pos.device_id]: updatedRoute,
        },
        devices: dev
          ? {
              ...state.devices,
              byId: {
                ...state.devices.byId,
                [pos.device_id]: {
                  ...dev,
                  position_id: pos.id,
                  last_update: pos.device_time || pos.server_time || dev.last_update,
                },
              },
            }
          : state.devices,
      };
    }),

  addEvent: (event) =>
    set((state) => {
      const updatedEvents = [event, ...state.events].slice(0, MAX_EVENTS);
      return { events: updatedEvents };
    }),

  handleEnvelope: (envelope) =>
    set((state) => {
      let devicesById = { ...state.devices.byId };
      let allIds = [...state.devices.allIds];
      let byDeviceId = { ...state.positions.byDeviceId };
      let routes = { ...state.routes };
      let events = [...state.events];

      if (envelope.devices && envelope.devices.length > 0) {
        for (const d of envelope.devices) {
          if (!devicesById[d.id]) {
            allIds.push(d.id);
          }
          devicesById[d.id] = { ...devicesById[d.id], ...d };
        }
      }

      if (envelope.positions && envelope.positions.length > 0) {
        for (const pos of envelope.positions) {
          byDeviceId[pos.device_id] = pos;
          const currentRoute = routes[pos.device_id] || [];
          routes[pos.device_id] = [...currentRoute, pos].slice(-MAX_ROUTE_POINTS);

          if (devicesById[pos.device_id]) {
            devicesById[pos.device_id] = {
              ...devicesById[pos.device_id],
              position_id: pos.id,
              last_update: pos.device_time || pos.server_time || devicesById[pos.device_id].last_update,
            };
          }
        }
      }

      if (envelope.events && envelope.events.length > 0) {
        events = [...envelope.events, ...events].slice(0, MAX_EVENTS);
      }

      return {
        devices: { byId: devicesById, allIds },
        positions: { byDeviceId },
        routes,
        events,
      };
    }),

  setGeofences: (geofencesList) =>
    set(() => {
      const byId: Record<string, Geofence> = {};
      const allIds: string[] = [];
      for (const g of geofencesList) {
        byId[g.id] = g;
        allIds.push(g.id);
      }
      return {
        geofences: { byId, allIds },
      };
    }),

  setSocketState: (socketUpdate) =>
    set((state) => ({
      socket: { ...state.socket, ...socketUpdate },
    })),

  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),

  reset: () =>
    set({
      devices: { byId: {}, allIds: [] },
      positions: { byDeviceId: {} },
      routes: {},
      events: [],
      geofences: { byId: {}, allIds: [] },
      socket: { connected: false, connecting: false, lastConnectedAt: null, reconnectAttempts: 0 },
      selectedDeviceId: null,
    }),
}));
