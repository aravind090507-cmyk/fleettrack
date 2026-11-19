import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdaptiveTrackingEngine,
  calculateLiveTrackingFreshness,
  haversineMeters,
} from '../services/adaptiveTracking';
import { LocationPing } from '../types';

describe('MODULE B: Adaptive GPS Tracking Engine', () => {
  let engine: AdaptiveTrackingEngine;

  beforeEach(() => {
    engine = new AdaptiveTrackingEngine({
      movingSpeedKmh: 5.0,
      trafficSpeedKmh: 1.5,
      stationaryDisplacementMeters: 20.0,
      stationaryDurationSec: 120, // 2 minutes
      extendedIdleDurationSec: 300, // 5 minutes
      movingIntervalSec: 5,
      trafficIntervalSec: 15,
      stationaryIntervalSec: 30,
      extendedIdleIntervalSec: 60,
      wakeupDisplacementMeters: 20.0,
    });
  });

  it('Scenario 1: Vehicle moving normally operates at 5s interval', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').toISOString();
    const ping1: LocationPing = {
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 35.0,
      heading: 90,
      accuracy: 5.0,
      timestamp: t0,
    };

    const res = engine.processPing(ping1);
    expect(res.state).toBe('MOVING');
    expect(res.acquisitionIntervalSec).toBe(5);
    expect(res.transmissionIntervalSec).toBe(5);
    expect(res.batterySaving).toBe(false);
    expect(res.shouldTransmit).toBe(true);
    expect(res.displayMessage).toBe('Updating every 5 seconds');
  });

  it('Scenario 2: Vehicle moving slowly in traffic enters TRAFFIC state with 15s interval', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();
    // First ping moving
    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 25.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });

    // Second ping slow crawl at 3 km/h
    const res = engine.processPing({
      latitude: 13.0828,
      longitude: 80.2708,
      speed: 3.0,
      accuracy: 6.0,
      timestamp: new Date(t0 + 5000).toISOString(),
    });

    expect(res.state).toBe('TRAFFIC');
    expect(res.acquisitionIntervalSec).toBe(15);
    expect(res.transmissionIntervalSec).toBe(15);
    expect(res.displayMessage).toBe('Reduced updates — Traffic');
    expect(res.batterySaving).toBe(false);
  });

  it('Scenario 3 & 4: Stationary vehicle transitions to STATIONARY after 2 minutes', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();

    // Initial stop at 0 km/h
    const r1 = engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });
    // Immediately stays in TRAFFIC/grace window before full 2 minutes
    expect(r1.state).toBe('TRAFFIC');

    // After 130 seconds (greater than 120s stationary duration) at same spot
    const r2 = engine.processPing({
      latitude: 13.082705, // ~0.5m drift
      longitude: 80.270705,
      speed: 0.0,
      accuracy: 6.0,
      timestamp: new Date(t0 + 130000).toISOString(),
    });

    expect(r2.state).toBe('STATIONARY');
    expect(r2.acquisitionIntervalSec).toBe(30);
    expect(r2.transmissionIntervalSec).toBe(30);
    expect(r2.displayMessage).toBe('Updating every 30 seconds');
    expect(r2.batterySaving).toBe(false);
  });

  it('Scenario 5: Extended idle transition after 5 minutes with battery saving active', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();

    // Start stop
    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });

    // 310 seconds later (over 5 min)
    const res = engine.processPing({
      latitude: 13.082708,
      longitude: 80.270708,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 310000).toISOString(),
    });

    expect(res.state).toBe('EXTENDED_IDLE');
    expect(res.acquisitionIntervalSec).toBe(60);
    expect(res.transmissionIntervalSec).toBe(60);
    expect(res.batterySaving).toBe(true);
    expect(res.displayMessage).toBe('Battery-saving mode');
  });

  it('Scenario 6: Automatic movement resumption with instant wakeup and immediate transmission', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();

    // Enter stationary
    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });
    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 150000).toISOString(),
    });
    expect(engine.getSnapshot().state).toBe('STATIONARY');

    // Movement resumes: Vehicle starts accelerating (> 5 km/h) or moves > 20m
    const wakeupPing = engine.processPing({
      latitude: 13.0835, // ~90 meters displacement
      longitude: 80.2715,
      speed: 22.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 160000).toISOString(),
    });

    expect(wakeupPing.state).toBe('MOVING');
    expect(wakeupPing.acquisitionIntervalSec).toBe(5);
    expect(wakeupPing.transmissionIntervalSec).toBe(5);
    expect(wakeupPing.shouldTransmit).toBe(true); // Must transmit immediately!
    expect(wakeupPing.batterySaving).toBe(false);
  });

  it('Scenario 7: GPS noise while stationary is suppressed by hysteresis', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();

    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });

    // 140s later, minor 4-meter noise drift at speed 1.0 km/h
    const res = engine.processPing({
      latitude: 13.08273,
      longitude: 80.27072,
      speed: 1.0,
      accuracy: 8.0,
      timestamp: new Date(t0 + 140000).toISOString(),
    });

    // Should NOT falsely trigger MOVING state
    expect(res.state).toBe('STATIONARY');
    expect(res.batterySaving).toBe(false);
  });

  it('Scenario 8: Network transmission throttling adheres to adaptive schedule', () => {
    const t0 = new Date('2026-11-19T10:00:00Z').getTime();

    // Stationary state established
    engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0).toISOString(),
    });
    const rStat = engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 130000).toISOString(),
    });
    expect(rStat.shouldTransmit).toBe(true);

    // Only 10 seconds later in STATIONARY mode (which transmits every 30s)
    const rThrottled = engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 140000).toISOString(),
    });
    // Throttled! Saves battery and network bandwidth
    expect(rThrottled.shouldTransmit).toBe(false);

    // 35 seconds later (past 30s threshold)
    const rAllowed = engine.processPing({
      latitude: 13.0827,
      longitude: 80.2707,
      speed: 0.0,
      accuracy: 5.0,
      timestamp: new Date(t0 + 165000).toISOString(),
    });
    expect(rAllowed.shouldTransmit).toBe(true);
  });
});

describe('MODULE A & B: Live Tracking Freshness Calculation', () => {
  it('Calculates LIVE state when updates arrive within interval', () => {
    const now = Date.now();
    const fresh = calculateLiveTrackingFreshness(now - 3000, 5, true, 'MOVING');
    expect(fresh.connectionStatus).toBe('LIVE');
    expect(fresh.isDelayed).toBe(false);
    expect(fresh.isStale).toBe(false);
    expect(fresh.countdownSec).toBeGreaterThan(0);
  });

  it('Classifies stationary vehicle as STATIONARY, not disconnected', () => {
    const now = Date.now();
    const fresh = calculateLiveTrackingFreshness(now - 12000, 30, true, 'STATIONARY');
    expect(fresh.connectionStatus).toBe('STATIONARY');
    expect(fresh.isStale).toBe(false);
  });

  it('Identifies delayed updates exceeding interval tolerance', () => {
    const now = Date.now();
    // 5s interval + tolerance (9s). At 15s elapsed:
    const fresh = calculateLiveTrackingFreshness(now - 15000, 5, true, 'MOVING');
    expect(fresh.connectionStatus).toBe('LOCATION DELAYED');
    expect(fresh.isDelayed).toBe(true);
  });

  it('Marks LOCATION STALE when update exceeds 2.5x interval and minimum threshold', () => {
    const now = Date.now();
    // 60s elapsed on a 5s interval -> stale
    const fresh = calculateLiveTrackingFreshness(now - 60000, 5, true, 'MOVING');
    expect(fresh.connectionStatus).toBe('LOCATION STALE');
    expect(fresh.isStale).toBe(true);
  });

  it('Marks RECONNECTING when WebSocket is disconnected', () => {
    const now = Date.now();
    const fresh = calculateLiveTrackingFreshness(now - 2000, 5, false, 'MOVING');
    expect(fresh.connectionStatus).toBe('RECONNECTING');
  });
});
