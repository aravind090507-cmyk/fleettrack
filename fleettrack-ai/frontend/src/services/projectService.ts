import apiClient from './api';
import { Project, Geofence } from '../types';

export const projectService = {
  async getProjects(params?: { status?: string; manager_id?: string }): Promise<Project[]> {
    const response = await apiClient.get<Project[]>('/api/v1/projects', { params });
    return response.data;
  },

  async getProject(id: string): Promise<Project> {
    const response = await apiClient.get<Project>(`/api/v1/projects/${id}`);
    return response.data;
  },

  async createProject(data: {
    name: string;
    description?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    status?: string;
    start_date?: string;
    end_date?: string;
    assigned_manager_id?: string | null;
  }): Promise<Project> {
    const response = await apiClient.post<Project>('/api/v1/projects', data);
    return response.data;
  },

  async updateProject(id: string, data: Partial<Project>): Promise<Project> {
    const response = await apiClient.put<Project>(`/api/v1/projects/${id}`, data);
    return response.data;
  },

  async deleteProject(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/projects/${id}`);
  },

  // Geofence management
  async getGeofences(params?: { project_id?: string }): Promise<Geofence[]> {
    const response = await apiClient.get<Geofence[]>('/api/v1/geofences', { params });
    return response.data;
  },

  async createGeofence(data: {
    name: string;
    project_id?: string | null;
    geofence_type: string;
    center_lat?: number | null;
    center_lng?: number | null;
    radius_meters?: number | null;
    polygon_coords?: { lat: number; lng: number }[] | null;
    is_active?: boolean;
  }): Promise<Geofence> {
    const response = await apiClient.post<Geofence>('/api/v1/geofences', data);
    return response.data;
  },

  async updateGeofence(id: string, data: Partial<Geofence>): Promise<Geofence> {
    const response = await apiClient.put<Geofence>(`/api/v1/geofences/${id}`, data);
    return response.data;
  },

  async deleteGeofence(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/geofences/${id}`);
  },
};

export default projectService;
