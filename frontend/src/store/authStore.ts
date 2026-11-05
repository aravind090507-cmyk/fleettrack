import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, role?: string) => Promise<User>;
  logout: () => void;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('fleet_token'),
  isAuthenticated: !!localStorage.getItem('fleet_token'),
  isLoading: false,

  initialize: () => {
    const savedToken = localStorage.getItem('fleet_token');
    const savedUser = localStorage.getItem('fleet_user');
    if (savedToken && savedUser) {
      try {
        set({
          token: savedToken,
          user: JSON.parse(savedUser),
          isAuthenticated: true,
        });
      } catch {
        localStorage.removeItem('fleet_token');
        localStorage.removeItem('fleet_user');
      }
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const data = await authApi.login(email, password);
      localStorage.setItem('fleet_token', data.access_token);
      localStorage.setItem('fleet_user', JSON.stringify(data.user));
      set({
        token: data.access_token,
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
      });
      return data.user;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (name, email, password, role = 'DRIVER') => {
    set({ isLoading: true });
    try {
      const data = await authApi.register(name, email, password, role);
      localStorage.setItem('fleet_token', data.access_token);
      localStorage.setItem('fleet_user', JSON.stringify(data.user));
      set({
        token: data.access_token,
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
      });
      return data.user;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('fleet_token');
    localStorage.removeItem('fleet_user');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },
}));
