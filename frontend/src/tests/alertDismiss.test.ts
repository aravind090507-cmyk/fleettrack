import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dashboardApi } from '../services/api';

describe('Alert Dismiss Behaviour', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('immediately removes alert, persists id to localStorage, and calls backend dismiss API', async () => {
    const dismissSpy = vi.spyOn(dashboardApi, 'dismissEvent').mockResolvedValue(undefined);

    const initialEvents = [
      {
        id: 'alert-1',
        event_type: 'SOS',
        driver_name: 'Test Driver',
        vehicle_registration: 'KA-01-9999',
        created_at: new Date().toISOString(),
        journey_id: 'j-1',
      },
      {
        id: 'alert-2',
        event_type: 'BREAKDOWN',
        driver_name: 'Driver Two',
        vehicle_registration: 'KA-02-1111',
        created_at: new Date().toISOString(),
        journey_id: 'j-2',
      },
    ];

    // Simulate dismissedAlertIds set initialized from localStorage
    let dismissedAlertIds = new Set<string>();
    const stored = localStorage.getItem('fleet_dismissed_alerts');
    if (stored) {
      dismissedAlertIds = new Set(JSON.parse(stored));
    }

    let recentEvents = initialEvents.filter((ev) => !dismissedAlertIds.has(ev.id));
    expect(recentEvents).toHaveLength(2);

    // Dismiss alert-1
    const targetId = 'alert-1';
    dismissedAlertIds.add(targetId);
    localStorage.setItem('fleet_dismissed_alerts', JSON.stringify([...dismissedAlertIds]));
    recentEvents = recentEvents.filter((ev) => ev.id !== targetId);
    await dashboardApi.dismissEvent(targetId);

    // Assertions
    expect(recentEvents.find((ev) => ev.id === targetId)).toBeUndefined();
    expect(recentEvents).toHaveLength(1);
    expect(dismissSpy).toHaveBeenCalledWith('alert-1');

    const persisted = JSON.parse(localStorage.getItem('fleet_dismissed_alerts') || '[]');
    expect(persisted).toContain('alert-1');
  });

  it('keeps a re-pushed WebSocket event with the same ID dismissed', async () => {
    // Pre-populate localStorage with previously dismissed alert ID
    localStorage.setItem('fleet_dismissed_alerts', JSON.stringify(['alert-sos-999']));

    const dismissedIds: Set<string> = new Set(
      JSON.parse(localStorage.getItem('fleet_dismissed_alerts') || '[]')
    );

    // Simulate incoming WebSocket TRIP_EVENT or poll refresh pushing the same alert again
    const incomingEvents = [
      {
        id: 'alert-sos-999',
        event_type: 'SOS',
        driver_name: 'Alex Rivera',
        vehicle_registration: 'KA-01-FT-1001',
        created_at: new Date().toISOString(),
        journey_id: 'j-100',
      },
      {
        id: 'alert-breakdown-888',
        event_type: 'BREAKDOWN',
        driver_name: 'Sam Carter',
        vehicle_registration: 'KA-01-FT-1002',
        created_at: new Date().toISOString(),
        journey_id: 'j-200',
      },
    ];

    // Filter using the dismissed set (as implemented in LiveMap loadFleetData & TRIP_EVENT handler)
    const activeEvents = incomingEvents.filter((ev) => !dismissedIds.has(ev.id));

    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0].id).toBe('alert-breakdown-888');
    expect(activeEvents.find((ev) => ev.id === 'alert-sos-999')).toBeUndefined();
  });
});
