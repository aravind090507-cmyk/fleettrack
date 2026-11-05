import apiClient from './api';
import { VehicleLocation, RouteHistoryPoint, RouteStats, ETAResult } from '../types';

export const locationService = {
  async getLatestLocations(): Promise<VehicleLocation[]> {
    const response = await apiClient.get<VehicleLocation[]>('/api/v1/locations/latest');
    return response.data;
  },

  async getVehicleLatestLocation(vehicleId: string): Promise<VehicleLocation> {
    const response = await apiClient.get<VehicleLocation>(`/api/v1/locations/${vehicleId}/latest`);
    return response.data;
  },

  async getRouteHistory(
    vehicleId: string,
    params: { start_time?: string; end_time?: string; limit?: number }
  ): Promise<{ points: RouteHistoryPoint[]; stats: RouteStats }> {
    const response = await apiClient.get<{ points: RouteHistoryPoint[]; stats: RouteStats }>(
      `/api/v1/locations/${vehicleId}/history`,
      { params }
    );
    return response.data;
  },

  async calculateETA(
    vehicleId: string,
    destination: { lat: number; lng: number } | { address: string }
  ): Promise<ETAResult> {
    const response = await apiClient.post<ETAResult>(
      `/api/v1/locations/${vehicleId}/eta`,
      destination
    );
    return response.data;
  },

  async getHistory(
    vehicleId: string,
    params?: { start_time?: string; end_time?: string; limit?: number }
  ): Promise<any> {
    const response = await apiClient.get(`/api/v1/vehicles/${vehicleId}/history`, { params });
    return response.data;
  },

  async getETA(
    vehicleId: string,
    dest_lat: number,
    dest_lng: number,
    dest_name?: string
  ): Promise<any> {
    const response = await apiClient.get(`/api/v1/vehicles/${vehicleId}/eta`, {
      params: { dest_lat, dest_lng, dest_name },
    });
    return response.data;
  },
};

export default locationService;
