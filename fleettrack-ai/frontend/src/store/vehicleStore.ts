import { create } from 'zustand';
import { Vehicle, VehicleLocation } from '../types';

interface VehicleStoreState {
  vehicles: Vehicle[];
  latestLocations: Record<string, VehicleLocation>;
  selectedVehicleIds: string[];
  isLoading: boolean;
  
  setVehicles: (vehicles: Vehicle[]) => void;
  updateLocation: (location: VehicleLocation) => void;
  setLatestLocations: (locations: Record<string, VehicleLocation>) => void;
  selectVehicle: (vehicleId: string) => void;
  deselectVehicle: (vehicleId: string) => void;
  toggleVehicleSelection: (vehicleId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
}

export const useVehicleStore = create<VehicleStoreState>((set, get) => ({
  vehicles: [],
  latestLocations: {},
  selectedVehicleIds: [],
  isLoading: false,

  setVehicles: (vehicles: Vehicle[]) => {
    // When vehicles are loaded, populate any embedded latest_location
    const currentLocs = { ...get().latestLocations };
    vehicles.forEach((v) => {
      if (v.latest_location) {
        currentLocs[v.id] = v.latest_location;
      }
    });
    set({ vehicles, latestLocations: currentLocs });
  },

  updateLocation: (location: VehicleLocation) => {
    set((state) => {
      const updatedLocations = {
        ...state.latestLocations,
        [location.vehicle_id]: location,
      };

      // Also update the vehicle status in the vehicle array if speed > 0
      const updatedVehicles = state.vehicles.map((v) => {
        if (v.id === location.vehicle_id) {
          const newStatus = location.speed > 1 ? 'moving' : location.speed === 0 ? 'idle' : v.status;
          return {
            ...v,
            status: newStatus,
            latest_location: location,
          };
        }
        return v;
      });

      return {
        latestLocations: updatedLocations,
        vehicles: updatedVehicles,
      };
    });
  },

  setLatestLocations: (locations: Record<string, VehicleLocation>) => {
    set({ latestLocations: locations });
  },

  selectVehicle: (vehicleId: string) => {
    set((state) => {
      if (state.selectedVehicleIds.includes(vehicleId)) return state;
      return { selectedVehicleIds: [...state.selectedVehicleIds, vehicleId] };
    });
  },

  deselectVehicle: (vehicleId: string) => {
    set((state) => ({
      selectedVehicleIds: state.selectedVehicleIds.filter((id) => id !== vehicleId),
    }));
  },

  toggleVehicleSelection: (vehicleId: string) => {
    const { selectedVehicleIds } = get();
    if (selectedVehicleIds.includes(vehicleId)) {
      get().deselectVehicle(vehicleId);
    } else {
      get().selectVehicle(vehicleId);
    }
  },

  selectAll: () => {
    set((state) => ({
      selectedVehicleIds: state.vehicles.map((v) => v.id),
    }));
  },

  clearSelection: () => {
    set({ selectedVehicleIds: [] });
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },
}));
