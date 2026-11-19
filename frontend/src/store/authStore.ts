import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../services/api';

export type PortalRole = 'DRIVER' | 'FLEET_MANAGER';

export const STORAGE_KEYS = {
  DRIVER_TOKEN: 'fleet_driver_token',
  DRIVER_USER: 'fleet_driver_user',
  MANAGER_TOKEN: 'fleet_manager_token',
  MANAGER_USER: 'fleet_manager_user',
  LEGACY_TOKEN: 'fleet_token',
  LEGACY_USER: 'fleet_user',
  TAB_ROLE: 'fleet_tab_role',
} as const;

/**
 * Resolves the portal role for the current window context.
 * Prioritizes route path, then tab-specific sessionStorage, and falls back gracefully.
 */
export const resolveCurrentPortalRole = (): PortalRole => {
  if (typeof window === 'undefined') return 'DRIVER';

  const pathname = window.location.pathname;
  if (pathname.startsWith('/driver')) {
    return 'DRIVER';
  }
  if (pathname.startsWith('/company') || pathname.startsWith('/dashboard')) {
    return 'FLEET_MANAGER';
  }

  // Check tab-isolated session storage
  try {
    const tabRole = sessionStorage.getItem(STORAGE_KEYS.TAB_ROLE) as PortalRole | null;
    if (tabRole === 'DRIVER' || tabRole === 'FLEET_MANAGER') {
      return tabRole;
    }
  } catch {
    // sessionStorage unavailable (e.g. security sandbox)
  }

  // Fallback to whichever portal token is available
  try {
    const hasManager = !!localStorage.getItem(STORAGE_KEYS.MANAGER_TOKEN);
    const hasDriver = !!localStorage.getItem(STORAGE_KEYS.DRIVER_TOKEN);
    if (hasManager && !hasDriver) return 'FLEET_MANAGER';
    if (hasDriver && !hasManager) return 'DRIVER';
  } catch {
    // localStorage unavailable
  }

  return 'DRIVER';
};

/**
 * Retrieve the isolated session for a specific role from storage.
 * Automatically backfills / migrates older single-key sessions if present.
 */
export const getStoredSession = (role: PortalRole): { token: string | null; user: User | null } => {
  if (typeof window === 'undefined') return { token: null, user: null };

  const tokenKey = role === 'FLEET_MANAGER' ? STORAGE_KEYS.MANAGER_TOKEN : STORAGE_KEYS.DRIVER_TOKEN;
  const userKey = role === 'FLEET_MANAGER' ? STORAGE_KEYS.MANAGER_USER : STORAGE_KEYS.DRIVER_USER;

  let token = localStorage.getItem(tokenKey);
  let userJson = localStorage.getItem(userKey);

  // Backward compatibility: migrate legacy single-key token if matching the role
  if (!token && !userJson) {
    const legacyToken = localStorage.getItem(STORAGE_KEYS.LEGACY_TOKEN);
    const legacyUser = localStorage.getItem(STORAGE_KEYS.LEGACY_USER);
    if (legacyToken && legacyUser) {
      try {
        const parsed = JSON.parse(legacyUser);
        const legacyRole = parsed.role === 'FLEET_MANAGER' || parsed.role === 'ADMIN' ? 'FLEET_MANAGER' : 'DRIVER';
        if (legacyRole === role) {
          token = legacyToken;
          userJson = legacyUser;
          localStorage.setItem(tokenKey, token);
          localStorage.setItem(userKey, userJson);
        }
      } catch {
        // ignore JSON parse error
      }
    }
  }

  if (token && userJson) {
    try {
      const user = JSON.parse(userJson) as User;
      return { token, user };
    } catch {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
    }
  }

  return { token: null, user: null };
};

/**
 * Persist an isolated session for a role, setting tab context and mirroring legacy keys.
 */
export const setStoredSession = (role: PortalRole, token: string, user: User): void => {
  if (typeof window === 'undefined') return;

  const tokenKey = role === 'FLEET_MANAGER' ? STORAGE_KEYS.MANAGER_TOKEN : STORAGE_KEYS.DRIVER_TOKEN;
  const userKey = role === 'FLEET_MANAGER' ? STORAGE_KEYS.MANAGER_USER : STORAGE_KEYS.DRIVER_USER;

  localStorage.setItem(tokenKey, token);
  localStorage.setItem(userKey, JSON.stringify(user));

  try {
    sessionStorage.setItem(STORAGE_KEYS.TAB_ROLE, role);
  } catch {
    // sessionStorage unavailable
  }

  // Mirror to legacy keys for tools or tests that inspect fleet_token
  localStorage.setItem(STORAGE_KEYS.LEGACY_TOKEN, token);
  localStorage.setItem(STORAGE_KEYS.LEGACY_USER, JSON.stringify(user));
};

/**
 * Safely clear isolated session storage without clobbering the other portal.
 */
export const clearStoredSession = (role?: PortalRole | 'all'): void => {
  if (typeof window === 'undefined') return;

  const clearLegacyIfMatches = (targetRole: PortalRole) => {
    try {
      const legacyUserJson = localStorage.getItem(STORAGE_KEYS.LEGACY_USER);
      if (legacyUserJson) {
        const parsed = JSON.parse(legacyUserJson);
        const legacyRole = parsed.role === 'FLEET_MANAGER' || parsed.role === 'ADMIN' ? 'FLEET_MANAGER' : 'DRIVER';
        if (legacyRole === targetRole) {
          localStorage.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
          localStorage.removeItem(STORAGE_KEYS.LEGACY_USER);
        }
      }
    } catch {}
  };

  if (role === 'DRIVER') {
    localStorage.removeItem(STORAGE_KEYS.DRIVER_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.DRIVER_USER);
    clearLegacyIfMatches('DRIVER');
    try {
      if (sessionStorage.getItem(STORAGE_KEYS.TAB_ROLE) === 'DRIVER') {
        sessionStorage.removeItem(STORAGE_KEYS.TAB_ROLE);
      }
    } catch {}
  } else if (role === 'FLEET_MANAGER') {
    localStorage.removeItem(STORAGE_KEYS.MANAGER_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.MANAGER_USER);
    clearLegacyIfMatches('FLEET_MANAGER');
    try {
      if (sessionStorage.getItem(STORAGE_KEYS.TAB_ROLE) === 'FLEET_MANAGER') {
        sessionStorage.removeItem(STORAGE_KEYS.TAB_ROLE);
      }
    } catch {}
  } else {
    // Clear all
    localStorage.removeItem(STORAGE_KEYS.DRIVER_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.DRIVER_USER);
    localStorage.removeItem(STORAGE_KEYS.MANAGER_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.MANAGER_USER);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_USER);
    try {
      sessionStorage.removeItem(STORAGE_KEYS.TAB_ROLE);
    } catch {}
  }
};

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, role?: string) => Promise<User>;
  logout: (targetPortal?: PortalRole | 'all') => void;
  initialize: (targetPortal?: PortalRole) => void;
  getPortalSession: (role: PortalRole) => { user: User | null; token: string | null; isAuthenticated: boolean };
}

export const useAuthStore = create<AuthState>((set, get) => {
  const initialRole = resolveCurrentPortalRole();
  const initialSession = getStoredSession(initialRole);

  return {
    user: initialSession.user,
    token: initialSession.token,
    isAuthenticated: !!initialSession.token,
    isLoading: false,

    initialize: (targetPortal?: PortalRole) => {
      const role = targetPortal || resolveCurrentPortalRole();
      const session = getStoredSession(role);
      set({
        token: session.token,
        user: session.user,
        isAuthenticated: !!session.token,
      });
    },

    getPortalSession: (role: PortalRole) => {
      const session = getStoredSession(role);
      return {
        user: session.user,
        token: session.token,
        isAuthenticated: !!session.token,
      };
    },

    login: async (email: string, password: string) => {
      set({ isLoading: true });
      try {
        const data = await authApi.login(email, password);
        const userRole: PortalRole =
          data.user.role === 'FLEET_MANAGER' || data.user.role === 'ADMIN'
            ? 'FLEET_MANAGER'
            : 'DRIVER';

        setStoredSession(userRole, data.access_token, data.user);

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

    register: async (name: string, email: string, password: string, role = 'DRIVER') => {
      set({ isLoading: true });
      try {
        const data = await authApi.register(name, email, password, role);
        const userRole: PortalRole =
          data.user.role === 'FLEET_MANAGER' || data.user.role === 'ADMIN'
            ? 'FLEET_MANAGER'
            : 'DRIVER';

        setStoredSession(userRole, data.access_token, data.user);

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

    logout: (targetPortal?: PortalRole | 'all') => {
      const role = targetPortal || resolveCurrentPortalRole();
      clearStoredSession(role);

      // Re-evaluate session for the active tab context
      const activeRole = resolveCurrentPortalRole();
      const session = getStoredSession(activeRole);
      set({
        user: session.user,
        token: session.token,
        isAuthenticated: !!session.token,
      });
    },
  };
});
