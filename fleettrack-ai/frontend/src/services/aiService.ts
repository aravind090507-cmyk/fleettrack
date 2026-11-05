import apiClient from './api';
import { AIMessage, AIInsight } from '../types';

export interface ChatResponseData {
  response: string;
  tool_calls_made?: any[];
  is_fallback?: boolean;
}

export const aiService = {
  async sendChatMessage(message: string, conversation_history: any[] = []): Promise<ChatResponseData> {
    const response = await apiClient.post<ChatResponseData>('/api/v1/ai/chat', {
      message,
      conversation_history,
    });
    return response.data;
  },

  async getInsights(params?: { vehicle_id?: string; insight_type?: string }): Promise<AIInsight[]> {
    const response = await apiClient.get<any>('/api/v1/ai/insights', {
      params,
    });
    return response.data.insights || response.data;
  },
};

export default aiService;
