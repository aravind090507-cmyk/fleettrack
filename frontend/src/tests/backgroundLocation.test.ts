import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backgroundLocation } from '../services/backgroundLocation';
import { calculateLiveTrackingFreshness, AdaptiveTrackingEngine } from '../services/adaptiveTracking';
import { LocationPing } from '../types';

describe('FLEETTRACK AI: Android Reliable Background GPS Tracking', () => {
  let engine: AdaptiveTrackingEngine;

  beforeEach(() => {
    engine = new AdaptiveTrackingEngine({
      movingSpeedKmh: 5.0,
      trafficSpeedKmh: 1.5,
      stationaryDisplacementMeters: 20.0,
      stationaryDurationSec: 120,
      extendedIdleDurationSec: 300,
      movingIntervalSec: 5,
      trafficIntervalSec: 15,
      stationaryIntervalSec: 30,
      extendedIdleIntervalSec: 60,
      wakeupDisplacementMeters: 20.0,
    });
  });

  describe('1. Web & PWA Safe Fallback', () => {
    it('isNativeAndroid returns false when running in browser test environment', () => {
      expect(backgroundLocation.isNativeAndroid()).toBe(false);
    });

    it('checkPermissions returns all-granted fallback in web browser without throwing', async () => {
      const perms = await backgroundLocation.checkPermissions();
      expect(perms.allGranted).toBe(true);
      expect(perms.fineLocation).toBe(true);
    });

    it('startTracking and stopTracking resolve gracefully on web platform', async () => {
      const startResult = await backgroundLocation.startTracking({
        journeyId: 'journey-bg-001',
        token: 'test-token',
        apiBaseUrl: 'http://127.0.0.1:8000',
        vehicleReg: 'VAN-01',
        destination: 'Central Depot',
      });
      expect(startResult).toBe(true);

      const status = await backgroundLocation.getTrackingStatus();
      expect(status).toBe(true);

      const stopResult = await backgroundLocation.stopTracking();
      expect(stopResult).toBe(true);

      const statusAfterStop = await backgroundLocation.getTrackingStatus();
      expect(statusAfterStop).toBe(false);
    });

    it('checkBatteryOptimizations returns true on web environment', async () => {
      const isIgnoring = await backgroundLocation.checkBatteryOptimizations();
      expect(isIgnoring).toBe(true);
    });
  });

  describe('2. Manager Portal Continuity While App is Minimized', () => {
    it('Scenario A: Minimized app in MOVING state (5s ping) remains LIVE on manager dashboard', () => {
      // 3 seconds elapsed since last GPS fix received by manager
      const now = Date.now();
      const lastFix = new Date(now - 3000).toISOString();
      const status = calculateLiveTrackingFreshness(lastFix, 5, true, 'MOVING');

      expect(status.connectionStatus).toBe('LIVE');
      expect(status.isDelayed).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.secondsElapsed).toBe(3);
      expect(status.countdownSec).toBe(2); // Next update in 2 seconds
    });

    it('Scenario B: Minimized app in TRAFFIC state (15s ping) remains LIVE without being reported disconnected', () => {
      // 10 seconds elapsed since last fix in slow traffic
      const now = Date.now();
      const lastFix = new Date(now - 10000).toISOString();
      const status = calculateLiveTrackingFreshness(lastFix, 15, true, 'TRAFFIC');

      expect(status.connectionStatus).toBe('LIVE');
      expect(status.isDelayed).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.secondsElapsed).toBe(10);
      expect(status.countdownSec).toBe(5); // Next update in 5 seconds
    });

    it('Scenario C: Minimized app in STATIONARY state (30s ping) reports STATIONARY, not disconnected', () => {
      // 20 seconds elapsed since last fix while vehicle is stopped
      const now = Date.now();
      const lastFix = new Date(now - 20000).toISOString();
      const status = calculateLiveTrackingFreshness(lastFix, 30, true, 'STATIONARY');

      expect(status.connectionStatus).toBe('STATIONARY');
      expect(status.isDelayed).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.secondsElapsed).toBe(20);
      expect(status.countdownSec).toBe(10); // Next update in 10 seconds
    });

    it('Scenario D: Extended idle battery-saving mode (60s ping) reports STATIONARY', () => {
      // 45 seconds elapsed since last fix during extended idle
      const now = Date.now();
      const lastFix = new Date(now - 45000).toISOString();
      const status = calculateLiveTrackingFreshness(lastFix, 60, true, 'EXTENDED_IDLE');

      expect(status.connectionStatus).toBe('STATIONARY');
      expect(status.isDelayed).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.secondsElapsed).toBe(45);
      expect(status.countdownSec).toBe(15);
    });

    it('Scenario E: Network tunnel or cell dead-zone triggers LOCATION DELAYED and LOCATION STALE', () => {
      const now = Date.now();
      // 20 seconds with 5s moving interval -> LOCATION DELAYED (20 > 5 + 4)
      const delayedFix = new Date(now - 20000).toISOString();
      const delayedStatus = calculateLiveTrackingFreshness(delayedFix, 5, true, 'MOVING');
      expect(delayedStatus.connectionStatus).toBe('LOCATION DELAYED');
      expect(delayedStatus.isDelayed).toBe(true);

      // 60 seconds elapsed with 5s interval -> LOCATION STALE (60 > 45s stale threshold)
      const staleFix = new Date(now - 60000).toISOString();
      const staleStatus = calculateLiveTrackingFreshness(staleFix, 5, true, 'MOVING');
      expect(staleStatus.connectionStatus).toBe('LOCATION STALE');
      expect(staleStatus.isStale).toBe(true);
    });

    it('Scenario F: WebSocket drop triggers RECONNECTING indicator immediately', () => {
      const now = Date.now();
      const lastFix = new Date(now - 2000).toISOString();
      const status = calculateLiveTrackingFreshness(lastFix, 5, false, 'MOVING');

      expect(status.connectionStatus).toBe('RECONNECTING');
    });
  });

  describe('3. Native Adaptive Rate Synchronization', () => {
    it('Syncs dynamic intervals: MOVING (5s) -> TRAFFIC (15s) -> STATIONARY (30s) -> EXTENDED_IDLE (60s)', () => {
      const t0 = new Date('2026-11-19T10:00:00Z').getTime();

      // 1. Moving fix
      const p1: LocationPing = {
        latitude: 13.0827,
        longitude: 80.2707,
        speed: 30.0,
        heading: 90,
        accuracy: 6.0,
        timestamp: new Date(t0).toISOString(),
      };
      const res1 = engine.processPing(p1);
      expect(res1.state).toBe('MOVING');
      expect(res1.acquisitionIntervalSec).toBe(5);

      // 2. Slow traffic fix
      const p2: LocationPing = {
        latitude: 13.0828,
        longitude: 80.2708,
        speed: 3.0,
        heading: 90,
        accuracy: 6.0,
        timestamp: new Date(t0 + 6000).toISOString(),
      };
      const res2 = engine.processPing(p2);
      expect(res2.state).toBe('TRAFFIC');
      expect(res2.acquisitionIntervalSec).toBe(15);

      // 3a. Initial stop at t0 + 10s establishes stationary anchor
      engine.processPing({
        latitude: 13.0828,
        longitude: 80.2708,
        speed: 0.0,
        heading: 90,
        accuracy: 4.0,
        timestamp: new Date(t0 + 10000).toISOString(),
      });

      // 3b. Stationary fix after 130s of elapsed stationary anchor (t0 + 140s)
      const p3: LocationPing = {
        latitude: 13.0828,
        longitude: 80.2708,
        speed: 0.0,
        heading: 90,
        accuracy: 4.0,
        timestamp: new Date(t0 + 140000).toISOString(),
      };
      const res3 = engine.processPing(p3);
      expect(res3.state).toBe('STATIONARY');
      expect(res3.acquisitionIntervalSec).toBe(30);

      // 4. Extended idle fix after > 300s of stationary anchor (t0 + 330s)
      const p4: LocationPing = {
        latitude: 13.0828,
        longitude: 80.2708,
        speed: 0.0,
        heading: 90,
        accuracy: 4.0,
        timestamp: new Date(t0 + 330000).toISOString(),
      };
      const res4 = engine.processPing(p4);
      expect(res4.state).toBe('EXTENDED_IDLE');
      expect(res4.acquisitionIntervalSec).toBe(60);
      expect(res4.batterySaving).toBe(true);
    });
  });
});
