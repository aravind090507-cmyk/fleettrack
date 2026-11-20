import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { useLocationPermission } from '../hooks/useLocationPermission';
import { LocationStatusIndicator } from '../components/driver/LocationStatusIndicator';
import { useDriverStore } from '../store/driverStore';

describe('Automatic GPS Location Permission Handling', () => {
  let mockGetCurrentPosition: ReturnType<typeof vi.fn>;
  let mockPermissionsQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset driver store
    useDriverStore.setState({
      currentJourney: null,
      trackingUrl: null,
      trackingToken: null,
      gpsStatus: 'idle',
      lastPing: null,
      locationPermission: 'checking',
      lastKnownLocation: null,
    });

    mockGetCurrentPosition = vi.fn();
    mockPermissionsQuery = vi.fn();

    // Mock navigator.geolocation
    Object.defineProperty(global.navigator, 'geolocation', {
      value: {
        getCurrentPosition: mockGetCurrentPosition,
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    // Mock navigator.permissions
    Object.defineProperty(global.navigator, 'permissions', {
      value: {
        query: mockPermissionsQuery,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Scenario 1: First-time driver login — auto-checks and triggers prompt when permission is prompt', async () => {
    // Permissions query returns 'prompt'
    mockPermissionsQuery.mockResolvedValue({
      state: 'prompt',
      onchange: null,
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    // Initially in checking/prompt state
    expect(result.current.statusDisplay).toBe('LOCATION PERMISSION REQUIRED');

    // navigator.geolocation.getCurrentPosition was called to trigger native prompt
    expect(mockGetCurrentPosition).toHaveBeenCalled();
  });

  it('Scenario 2: Permission granted — coordinates retrieved and displays LOCATION ENABLED without starting journey', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'granted',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 13.0827,
          longitude: 80.2707,
          accuracy: 5.5,
          heading: 90,
          speed: 10,
        },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('granted');
    expect(result.current.statusDisplay).toBe('LOCATION ENABLED');
    expect(result.current.coords?.latitude).toBe(13.0827);
    expect(result.current.coords?.longitude).toBe(80.2707);

    // Verify coordinates stored in store
    const storeState = useDriverStore.getState();
    expect(storeState.locationPermission).toBe('granted');
    expect(storeState.lastKnownLocation?.latitude).toBe(13.0827);

    // CRITICAL: Granting location permission must NOT start a journey or change driver availability automatically
    expect(storeState.currentJourney).toBeNull();
  });

  it('Scenario 3: Permission denied — displays LOCATION ACCESS DENIED with required message and retry button', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'denied',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 1, // PERMISSION_DENIED
        message: 'User denied Geolocation',
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('denied');
    expect(result.current.statusDisplay).toBe('LOCATION ACCESS DENIED');
    expect(result.current.errorMessage).toBe(
      'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
    );

    // Clear call count to verify no polling/spamming without user interaction
    mockGetCurrentPosition.mockClear();

    // Re-render hook: must NOT trigger prompt again without user action
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();

    // User explicitly clicks RETRY LOCATION PERMISSION
    await act(async () => {
      result.current.requestPermission();
    });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('Scenario 4: Permission previously granted — immediately acquires coordinates without user friction', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'granted',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 12.9716,
          longitude: 77.5946,
          accuracy: 8.0,
          heading: 0,
          speed: 0,
        },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('granted');
    expect(result.current.statusDisplay).toBe('LOCATION ENABLED');
    expect(result.current.coords?.latitude).toBe(12.9716);
  });

  it('Scenario 5: Permission revoked through browser settings — reactively updates via onchange', async () => {
    let changeListener: (() => void) | null = null;
    const mockPermissionStatus = {
      state: 'granted',
      onchange: null as any,
    };
    Object.defineProperty(mockPermissionStatus, 'onchange', {
      set(fn: () => void) {
        changeListener = fn;
      },
      get() {
        return changeListener || (() => {});
      },
      configurable: true,
    });

    mockPermissionsQuery.mockResolvedValue(mockPermissionStatus);

    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 13.0, longitude: 80.0, accuracy: 10 },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state).toBe('granted');

    // Simulate driver revoking permission in browser settings
    mockPermissionStatus.state = 'denied';
    await act(async () => {
      if (changeListener) {
        changeListener();
      }
    });

    expect(result.current.state).toBe('denied');
    expect(result.current.statusDisplay).toBe('LOCATION ACCESS DENIED');
    expect(result.current.errorMessage).toContain('Please enable location access in your browser settings.');
  });

  it('Scenario 6: Device location services disabled — displays TURN ON DEVICE LOCATION with required message', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'prompt',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 2, // POSITION_UNAVAILABLE
        message: 'Location provider disabled',
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('device_disabled');
    expect(result.current.statusDisplay).toBe('TURN ON DEVICE LOCATION');
    expect(result.current.errorMessage).toBe(
      'Your device location is turned off. Please enable GPS/location services and try again.'
    );
  });

  it('Scenario 7: GPS temporarily unavailable / timeout — displays LOCATION UNAVAILABLE', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'prompt',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 3, // TIMEOUT
        message: 'Timeout expired',
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('unavailable');
    expect(result.current.statusDisplay).toBe('LOCATION UNAVAILABLE');
    expect(result.current.errorMessage).toContain('GPS satellite lock timed out');
  });

  it('Scenario 8: Android Chrome environment — handles permissions.query and High Accuracy GPS', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'granted',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((success, _error, options) => {
      expect(options.enableHighAccuracy).toBe(true);
      success({
        coords: { latitude: 13.08, longitude: 80.27, accuracy: 4.2 },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('granted');
    expect(result.current.statusDisplay).toBe('LOCATION ENABLED');
  });

  it('Scenario 9: iOS Safari fallback — operates smoothly when navigator.permissions.query is unsupported or throws', async () => {
    // In Safari, permissions.query is often undefined or throws
    Object.defineProperty(global.navigator, 'permissions', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 13.0827, longitude: 80.2707, accuracy: 6.0 },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    // Gracefully acquired via direct getCurrentPosition fallback
    expect(result.current.state).toBe('granted');
    expect(result.current.statusDisplay).toBe('LOCATION ENABLED');
    expect(result.current.coords?.latitude).toBe(13.0827);
  });

  it('Scenario 10: Existing journey tracking — displays LIVE GPS TRACKING when active journey is in progress', async () => {
    // Set active journey in progress in store
    useDriverStore.setState({
      currentJourney: {
        id: 'journey-live-101',
        vehicle_id: 'veh-1',
        driver_id: 'drv-1',
        origin_name: 'Depot A',
        origin_lat: 13.0,
        origin_lng: 80.0,
        destination_name: 'Hub B',
        destination_lat: 13.1,
        destination_lng: 80.1,
        status: 'IN_PROGRESS',
        total_distance_km: 1.2,
        duration_seconds: 120,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    });

    mockPermissionsQuery.mockResolvedValue({
      state: 'granted',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 13.05, longitude: 80.05, accuracy: 5.0 },
        timestamp: Date.now(),
      });
    });

    const { result } = renderHook(() => useLocationPermission());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state).toBe('granted');
    // When journey is IN_PROGRESS, status must display LIVE GPS TRACKING
    expect(result.current.statusDisplay).toBe('LIVE GPS TRACKING');
  });

  it('UI Indicator: renders exact alert message and handles RETRY LOCATION PERMISSION click', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'denied',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({ code: 1, message: 'User denied' });
    });

    render(<LocationStatusIndicator />);

    await act(async () => {
      await Promise.resolve();
    });

    // Check status badge
    const badge = screen.getByTestId('location-status-badge');
    expect(badge.textContent).toContain('LOCATION ACCESS DENIED');

    // Check message text
    expect(
      screen.getByText(
        'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
      )
    ).toBeTruthy();

    // Check button label
    const retryBtn = screen.getByTestId('retry-location-permission-btn');
    expect(retryBtn.textContent).toContain('RETRY LOCATION PERMISSION');

    // Clicking retry calls request
    mockGetCurrentPosition.mockClear();
    fireEvent.click(retryBtn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('UI Indicator: renders TURN ON DEVICE LOCATION when device GPS is off', async () => {
    mockPermissionsQuery.mockResolvedValue({
      state: 'prompt',
      onchange: null,
    });

    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({ code: 2, message: 'Location provider disabled' });
    });

    render(<LocationStatusIndicator />);

    await act(async () => {
      await Promise.resolve();
    });

    const badge = screen.getByTestId('location-status-badge');
    expect(badge.textContent).toContain('TURN ON DEVICE LOCATION');

    expect(
      screen.getByText('Your device location is turned off. Please enable GPS/location services and try again.')
    ).toBeTruthy();
  });
});
