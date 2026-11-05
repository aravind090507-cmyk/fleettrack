import apiClient from './api';
import { Vehicle, SimulatorStatus } from '../types';

export interface VehicleFilterParams {
  status?: string;
  vehicle_type?: string;
  project_id?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const vehicleService = {
  async getVehicles(params?: VehicleFilterParams): Promise<Vehicle[]> {
    const response = await apiClient.get<Vehicle[]>('/api/v1/vehicles', { params });
    return response.data;
  },

  async getVehicle(id: string): Promise<Vehicle> {
    const response = await apiClient.get<Vehicle>(`/api/v1/vehicles/${id}`);
    return response.data;
  },

  async createVehicle(data: {
    registration_number: string;
    vehicle_type: string;
    device_id: string;
    assigned_manager_id?: string | null;
    assigned_project_id?: string | null;
    status?: string;
  }): Promise<Vehicle> {
    const response = await apiClient.post<Vehicle>('/api/v1/vehicles', data);
    return response.data;
  },

  async updateVehicle(id: string, data: Partial<Vehicle>): Promise<Vehicle> {
    const response = await apiClient.put<Vehicle>(`/api/v1/vehicles/${id}`, data);
    return response.data;
  },

  async deleteVehicle(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/vehicles/${id}`);
  },

  async getRecentEvents(limit: number = 20): Promise<any[]> {
    try {
      const response = await apiClient.get<any[]>('/api/v1/vehicles/events', {
        params: { limit },
      });
      return response.data;
    } catch {
      // Fallback or empty if endpoint not yet deployed
      return [];
    }
  },

  async getSimulatorStatus(): Promise<SimulatorStatus> {
    try {
      const response = await apiClient.get<SimulatorStatus>('/api/v1/simulation/status');
      return response.data;
    } catch {
      return { is_running: false, speed_multiplier: 1, active_simulated_vehicles: 0 };
    }
  },

  async controlSimulator(action: 'start' | 'stop' | 'pause' | 'resume', speedMultiplier: number = 1): Promise<SimulatorStatus> {
    const response = await apiClient.post<SimulatorStatus>(`/api/v1/simulation/${action}`, {
      speed_multiplier: speedMultiplier,
    });
    return response.data;
  },
  async deactivateVehicle(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/vehicles/${id}`);
  },

  async getVehicleEvents(limit: number = 20): Promise<any[]> {
    return this.getRecentEvents(limit);
  },
};

export default vehicleService;
