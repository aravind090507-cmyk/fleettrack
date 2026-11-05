import { create } from 'zustand';
import axios from 'axios';
import { User, LoginResponse } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  initialize: () => Promise<void>;
  setError: (error: string | null) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const TOKEN_KEY = 'fleettrack_token';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: !!localStorage.getItem(TOKEN_KEY),
  isLoading: true,
  error: null,

  setError: (error: string | null) => set({ error }),

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.post<LoginResponse>(
        `${API_BASE_URL}/api/v1/auth/login`,
        { email: email.trim(), password }
      );

      const token = response.data.access_token;
      localStorage.setItem(TOKEN_KEY, token);

      let user = response.data.user;
      if (!user) {
        const meRes = await axios.get<User>(`${API_BASE_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        user = meRes.data;
      }

      set({
        token,
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      let msg = 'Invalid email or password. Please try again.';
      if (err.response?.data?.detail) {
        msg = err.response.data.detail;
      } else if (err.response?.data?.message) {
        msg = err.response.data.message;
      } else if (err.code === 'ERR_NETWORK' || !err.response) {
        msg = `Cannot connect to FleetTrack backend at ${API_BASE_URL}. Please ensure the backend is running.`;
      }
      set({
        isLoading: false,
        error: typeof msg === 'string' ? msg : JSON.stringify(msg),
      });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },

  loadUser: async () => {
    const token = get().token || localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    try {
      const response = await axios.get<User>(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      set({
        user: response.data,
        token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      if (err.response?.status === 401) {
        get().logout();
      } else {
        set({ isLoading: false });
      }
    }
  },

  initialize: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      set({ token, isAuthenticated: true });
      await get().loadUser();
    } else {
      set({ isLoading: false, isAuthenticated: false, user: null });
    }
  },
}));
