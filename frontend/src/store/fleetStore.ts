import { create } from 'zustand';
import { ActiveVehicleTelemetry, DashboardOverview, Vehicle } from '../types';

interface FleetState {
  vehicles: Vehicle[];
  activeVehicles: ActiveVehicleTelemetry[];
  selectedVehicleId: string | null;
  overview: DashboardOverview | null;
  activeJourneys: any[];

  setVehicles: (vehicles: Vehicle[]) => void;
  setActiveVehicles: (activeVehicles: ActiveVehicleTelemetry[]) => void;
  setSelectedVehicleId: (id: string | null) => void;
  setOverview: (overview: DashboardOverview) => void;
  setActiveJourneys: (journeys: any[]) => void;
  updateVehiclePosition: (update: {
    vehicle_id: string;
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    recorded_at: string;
  }) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  vehicles: [],
  activeVehicles: [],
  selectedVehicleId: null,
  overview: null,
  activeJourneys: [],

  setVehicles: (vehicles) => set({ vehicles }),
  setActiveVehicles: (activeVehicles) => set({ activeVehicles }),
  setSelectedVehicleId: (selectedVehicleId) => set({ selectedVehicleId }),
  setOverview: (overview) => set({ overview }),
  setActiveJourneys: (activeJourneys) => set({ activeJourneys }),

  updateVehiclePosition: (update) =>
    set((state) => {
      const updatedActive = state.activeVehicles.map((v) => {
        if (v.vehicle_id === update.vehicle_id) {
          return {
            ...v,
            latest_latitude: update.latitude,
            latest_longitude: update.longitude,
            latest_speed: update.speed,
            latest_heading: update.heading,
            latest_recorded_at: update.recorded_at,
            status: 'IN_TRANSIT',
          };
        }
        return v;
      });
      return { activeVehicles: updatedActive };
    }),
}));
