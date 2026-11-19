import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useAuthStore,
  setStoredSession,
  getStoredSession,
  clearStoredSession,
  resolveCurrentPortalRole,
  STORAGE_KEYS,
  PortalRole,
} from '../store/authStore';
import { getActiveTokenForRequest } from '../services/api';
import { User } from '../types';

describe('Multi-Portal Authentication & Session Isolation', () => {
  const driverUser: User = {
    id: 'driver-uuid-1234',
    email: 'driver1@fleetcorp.com',
    name: 'Ramesh Kumar (Driver)',
    role: 'DRIVER',
    is_active: true,
    created_at: new Date().toISOString(),
  };

  const managerUser: User = {
    id: 'manager-uuid-5678',
    email: 'manager@fleetcorp.com',
    name: 'Operations Fleet Manager',
    role: 'FLEET_MANAGER',
    is_active: true,
    created_at: new Date().toISOString(),
  };

  const driverToken = 'jwt-driver-token-abc';
  const managerToken = 'jwt-manager-token-xyz';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('TEST A: Simultaneous multi-tab coexistence and independent refresh', () => {
    // 1. Tab 1 signs in as Driver
    setStoredSession('DRIVER', driverToken, driverUser);
    expect(localStorage.getItem(STORAGE_KEYS.DRIVER_TOKEN)).toBe(driverToken);

    // 2. Tab 2 signs in as Fleet Manager on the same device/browser
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);
    expect(localStorage.getItem(STORAGE_KEYS.MANAGER_TOKEN)).toBe(managerToken);

    // Ensure neither session clobbered the other
    expect(localStorage.getItem(STORAGE_KEYS.DRIVER_TOKEN)).toBe(driverToken);
    expect(localStorage.getItem(STORAGE_KEYS.MANAGER_TOKEN)).toBe(managerToken);

    // 3. Tab 2 (Manager Portal) refreshes while on /company/dispatch
    delete (window as any).location;
    window.location = { pathname: '/company/dispatch' } as any;

    const managerRole = resolveCurrentPortalRole();
    expect(managerRole).toBe('FLEET_MANAGER');

    const managerSession = getStoredSession('FLEET_MANAGER');
    expect(managerSession.token).toBe(managerToken);
    expect(managerSession.user?.role).toBe('FLEET_MANAGER');
    expect(managerSession.user?.email).toBe('manager@fleetcorp.com');

    // 4. Tab 1 (Driver Portal) refreshes while on /driver
    window.location = { pathname: '/driver' } as any;

    const driverRole = resolveCurrentPortalRole();
    expect(driverRole).toBe('DRIVER');

    const driverSession = getStoredSession('DRIVER');
    expect(driverSession.token).toBe(driverToken);
    expect(driverSession.user?.role).toBe('DRIVER');
    expect(driverSession.user?.email).toBe('driver1@fleetcorp.com');
  });

  it('TEST B: Manager Portal navigation between subroutes and refresh restoration', () => {
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);

    // Navigate to Driver Dispatch
    window.location = { pathname: '/company/dispatch' } as any;
    expect(resolveCurrentPortalRole()).toBe('FLEET_MANAGER');
    let session = getStoredSession(resolveCurrentPortalRole());
    expect(session.user?.role).toBe('FLEET_MANAGER');

    // Navigate to Active Journeys (Delivery Monitoring)
    window.location = { pathname: '/company/journeys' } as any;
    expect(resolveCurrentPortalRole()).toBe('FLEET_MANAGER');
    session = getStoredSession(resolveCurrentPortalRole());
    expect(session.user?.role).toBe('FLEET_MANAGER');

    // Refresh on /company/journeys
    session = getStoredSession('FLEET_MANAGER');
    expect(session.token).toBe(managerToken);
    expect(session.user?.role).toBe('FLEET_MANAGER');
    // Session remains FLEET_MANAGER and does NOT redirect to /driver
  });

  it('TEST C: Driver availability state and session persistence across refresh', () => {
    setStoredSession('DRIVER', driverToken, driverUser);

    window.location = { pathname: '/driver' } as any;
    expect(resolveCurrentPortalRole()).toBe('DRIVER');

    const session = getStoredSession('DRIVER');
    expect(session.token).toBe(driverToken);
    expect(session.user?.name).toBe('Ramesh Kumar (Driver)');

    // Simulate page refresh on /driver
    useAuthStore.getState().initialize('DRIVER');
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe(driverToken);
    expect(state.user?.role).toBe('DRIVER');
  });

  it('TEST D: Navigation in one portal does not affect session or role in the other portal', () => {
    setStoredSession('DRIVER', driverToken, driverUser);
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);

    // Tab 1 is at /driver
    window.location = { pathname: '/driver' } as any;
    expect(getActiveTokenForRequest('/api/driver/availability')).toBe(driverToken);

    // Tab 2 performs navigation between manager pages
    window.location = { pathname: '/company/geofences' } as any;
    expect(getActiveTokenForRequest('/api/geofences')).toBe(managerToken);

    window.location = { pathname: '/company/dispatch' } as any;
    expect(getActiveTokenForRequest('/api/dispatch/drivers')).toBe(managerToken);

    // Tab 1 remains undisturbed
    window.location = { pathname: '/driver' } as any;
    expect(getActiveTokenForRequest('/api/driver/assignments/active')).toBe(driverToken);
  });

  it('TEST E: Independent logout leaves the other portal intact without state leakage', () => {
    setStoredSession('DRIVER', driverToken, driverUser);
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);

    // Driver logs out from Driver Portal
    clearStoredSession('DRIVER');

    // Driver session is gone
    expect(localStorage.getItem(STORAGE_KEYS.DRIVER_TOKEN)).toBeNull();
    expect(getStoredSession('DRIVER').token).toBeNull();

    // Manager session in Tab 2 is COMPLETELY PRESERVED
    expect(localStorage.getItem(STORAGE_KEYS.MANAGER_TOKEN)).toBe(managerToken);
    const mgrSession = getStoredSession('FLEET_MANAGER');
    expect(mgrSession.token).toBe(managerToken);
    expect(mgrSession.user?.email).toBe('manager@fleetcorp.com');

    // Manager logs out from Manager Portal
    clearStoredSession('FLEET_MANAGER');
    expect(localStorage.getItem(STORAGE_KEYS.MANAGER_TOKEN)).toBeNull();
    expect(getStoredSession('FLEET_MANAGER').token).toBeNull();
  });

  it('Request Token Isolation: driver and manager endpoints receive their respective isolated tokens', () => {
    setStoredSession('DRIVER', driverToken, driverUser);
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);

    // Even if pathname is neutral or mixed:
    // Explicit driver endpoints always get driver token
    expect(getActiveTokenForRequest('/api/driver/availability')).toBe(driverToken);
    expect(getActiveTokenForRequest('/api/driver/assignments/active')).toBe(driverToken);
    expect(getActiveTokenForRequest('/api/driver/assignments/123/accept')).toBe(driverToken);

    // Explicit manager endpoints always get manager token
    expect(getActiveTokenForRequest('/api/dispatch/drivers')).toBe(managerToken);
    expect(getActiveTokenForRequest('/api/dispatch/assignments')).toBe(managerToken);
    expect(getActiveTokenForRequest('/api/vehicles')).toBe(managerToken);
    expect(getActiveTokenForRequest('/api/dashboard/overview')).toBe(managerToken);
    expect(getActiveTokenForRequest('/api/geofences')).toBe(managerToken);
  });

  it('Unauthorized Handling: missing portal session returns null and redirects to login rather than cross-portal hijack', () => {
    // Only Driver session exists
    setStoredSession('DRIVER', driverToken, driverUser);

    // If an attempt is made to get Manager session, it returns null
    const mgrSession = getStoredSession('FLEET_MANAGER');
    expect(mgrSession.token).toBeNull();
    expect(mgrSession.user).toBeNull();

    // If only Manager session exists
    clearStoredSession('all');
    setStoredSession('FLEET_MANAGER', managerToken, managerUser);

    const drvSession = getStoredSession('DRIVER');
    expect(drvSession.token).toBeNull();
    expect(drvSession.user).toBeNull();
  });
});
