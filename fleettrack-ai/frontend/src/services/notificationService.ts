import apiClient from './api';
import { Notification } from '../types';

export const notificationService = {
  async getNotifications(params?: { unread_only?: boolean; limit?: number }): Promise<Notification[]> {
    const response = await apiClient.get<Notification[]>('/api/v1/notifications', { params });
    return response.data;
  },

  async markAsRead(id: string): Promise<Notification> {
    const response = await apiClient.put<Notification>(`/api/v1/notifications/${id}/read`);
    return response.data;
  },

  async markAllAsRead(): Promise<{ count: number }> {
    const response = await apiClient.put<{ count: number }>('/api/v1/notifications/read-all');
    return response.data;
  },
};

export default notificationService;
