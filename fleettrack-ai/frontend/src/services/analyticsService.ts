import apiClient from './api';
import { FleetSummary, VehicleActivity } from '../types';

export interface DailyDistancePoint {
  date: string;
  distance_km: number;
}

export interface SpeedDistributionPoint {
  range: string;
  count: number;
}

export const analyticsService = {
  async getFleetSummary(): Promise<FleetSummary> {
    const response = await apiClient.get<FleetSummary>('/api/v1/analytics/fleet-summary');
    return response.data;
  },

  async getVehicleActivity(params?: {
    start_date?: string;
    end_date?: string;
    vehicle_id?: string;
    project_id?: string;
  }): Promise<VehicleActivity[]> {
    const response = await apiClient.get<VehicleActivity[]>('/api/v1/analytics/vehicle-activity', {
      params,
    });
    return response.data;
  },

  async getDailyDistance(params?: {
    days?: number;
    start_date?: string;
    end_date?: string;
    vehicle_id?: string;
    project_id?: string;
  }): Promise<DailyDistancePoint[]> {
    const response = await apiClient.get<DailyDistancePoint[]>('/api/v1/analytics/daily-distance', {
      params,
    });
    return response.data;
  },

  async getSpeedDistribution(params?: {
    start_date?: string;
    end_date?: string;
    vehicle_id?: string;
  }): Promise<SpeedDistributionPoint[]> {
    const response = await apiClient.get<SpeedDistributionPoint[]>('/api/v1/analytics/speed-distribution', {
      params,
    });
    return response.data;
  },
};

export default analyticsService;
