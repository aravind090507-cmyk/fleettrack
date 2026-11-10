import { describe, it, expect, beforeEach } from 'vitest';
import { useTelematicsStore } from '../store/telematicsStore';
import { Device, Position, TelematicsEnvelope, TelematicsEvent } from '../types';

describe('useTelematicsStore', () => {
  beforeEach(() => {
    useTelematicsStore.getState().reset();
  });

  it('sets and updates devices correctly', () => {
    const store = useTelematicsStore.getState();
    const dev1: Device = {
      id: 'd1',
      unique_id: 'imei-001',
      name: 'Truck Alpha',
      status: 'offline',
      disabled: false,
      last_update: null,
      position_id: null,
      attributes: {},
    };

    store.setDevices([dev1]);
    expect(useTelematicsStore.getState().devices.allIds).toContain('d1');
    expect(useTelematicsStore.getState().devices.byId['d1'].name).toBe('Truck Alpha');

    store.updateDevice({ id: 'd1', status: 'online' });
    expect(useTelematicsStore.getState().devices.byId['d1'].status).toBe('online');
  });

  it('adds positions and enforces 50-point ring buffer per device', () => {
    const store = useTelematicsStore.getState();

    for (let i = 0; i < 60; i++) {
      const pos: Position = {
        id: i + 1,
        device_id: 'd1',
        protocol: 'osmand',
        server_time: new Date().toISOString(),
        device_time: new Date().toISOString(),
        fix_time: new Date().toISOString(),
        valid: true,
        outdated: false,
        latitude: 12.9 + i * 0.001,
        longitude: 77.5 + i * 0.001,
        altitude: 100,
        speed: 25,
        course: 90,
        accuracy: 5,
        distance_m: 10,
        total_distance_m: i * 10,
        motion: true,
        geofence_ids: [],
        attributes: {},
      };
      store.addPosition(pos);
    }

    const state = useTelematicsStore.getState();
    expect(state.positions.byDeviceId['d1']).toBeDefined();
    expect(state.positions.byDeviceId['d1'].id).toBe(60);
    // Max route points is 50
    expect(state.routes['d1'].length).toBe(50);
    expect(state.routes['d1'][0].id).toBe(11);
    expect(state.routes['d1'][49].id).toBe(60);
  });

  it('handles ENVELOPE message with devices, positions, and events atomically', () => {
    const store = useTelematicsStore.getState();

    const envelope: TelematicsEnvelope = {
      type: 'ENVELOPE',
      devices: [
        {
          id: 'dev-100',
          unique_id: '100',
          name: 'Van 100',
          status: 'online',
          disabled: false,
          last_update: '2026-11-10T10:00:00Z',
          position_id: 1,
          attributes: {},
        },
      ],
      positions: [
        {
          id: 501,
          device_id: 'dev-100',
          protocol: 'osmand',
          server_time: '2026-11-10T10:00:00Z',
          device_time: '2026-11-10T10:00:00Z',
          fix_time: '2026-11-10T10:00:00Z',
          valid: true,
          outdated: false,
          latitude: 12.9716,
          longitude: 77.5946,
          speed: 40,
          course: 180,
          accuracy: 8,
          distance_m: 50,
          total_distance_m: 500,
          motion: true,
          geofence_ids: ['geo-1'],
          attributes: {},
        },
      ],
      events: [
        {
          id: 'ev-1',
          type: 'deviceMoving',
          event_time: '2026-11-10T10:00:00Z',
          device_id: 'dev-100',
          attributes: { speed: 40 },
        },
      ],
    };

    store.handleEnvelope(envelope);

    const state = useTelematicsStore.getState();
    expect(state.devices.byId['dev-100']).toBeDefined();
    expect(state.positions.byDeviceId['dev-100'].latitude).toBe(12.9716);
    expect(state.events.length).toBe(1);
    expect(state.events[0].type).toBe('deviceMoving');
  });

  it('enforces 100-event ring buffer on events', () => {
    const store = useTelematicsStore.getState();

    for (let i = 0; i < 120; i++) {
      const ev: TelematicsEvent = {
        id: `ev-${i}`,
        type: i % 2 === 0 ? 'deviceMoving' : 'deviceStopped',
        event_time: new Date().toISOString(),
        device_id: 'd1',
        attributes: { index: i },
      };
      store.addEvent(ev);
    }

    const state = useTelematicsStore.getState();
    expect(state.events.length).toBe(100);
    expect(state.events[0].id).toBe('ev-119');
  });
});
