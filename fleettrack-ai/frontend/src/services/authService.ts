import apiClient from './api';
import { User, LoginResponse } from '../types';

export const authService = {
  async login(formData: FormData | URLSearchParams | { email: string; password: string }): Promise<LoginResponse> {
    const isUrlEncoded = formData instanceof URLSearchParams;
    const isFormData = formData instanceof FormData;
    const headers = isUrlEncoded || isFormData 
      ? { 'Content-Type': 'application/x-www-form-urlencoded' } 
      : { 'Content-Type': 'application/json' };

    const response = await apiClient.post<LoginResponse>('/api/v1/auth/login', formData, { headers });
    return response.data;
  },

  async getMe(): Promise<User> {
    const response = await apiClient.get<User>('/api/v1/auth/me');
    return response.data;
  },

  async getUsers(): Promise<User[]> {
    const response = await apiClient.get<User[]>('/api/v1/users');
    return response.data;
  },

  async createUser(data: { name: string; email: string; password: string; role: string }): Promise<User> {
    const response = await apiClient.post<User>('/api/v1/users', data);
    return response.data;
  },

  async updateUser(id: string, data: Partial<User & { password?: string }>): Promise<User> {
    const response = await apiClient.put<User>(`/api/v1/users/${id}`, data);
    return response.data;
  },

  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/users/${id}`);
  },
};

export default authService;
