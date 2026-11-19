import { LocationPing, AdaptiveTrackingState } from '../types';

export interface AdaptiveConfig {
  movingSpeedKmh: number; // Speed threshold for normal movement (> 5 km/h)
  trafficSpeedKmh: number; // Speed threshold for slow traffic / crawl (> 1.5 and <= 5)
  stationaryDisplacementMeters: number; // Max displacement to consider stationary (20m)
  stationaryDurationSec: number; // Time window before entering STATIONARY (120s / 2 min)
  extendedIdleDurationSec: number; // Time window before entering EXTENDED_IDLE (300s / 5 min)
  movingIntervalSec: number; // 5s
  trafficIntervalSec: number; // 15s
  stationaryIntervalSec: number; // 30s
  extendedIdleIntervalSec: number; // 60s
  wakeupDisplacementMeters: number; // Instant wakeup displacement threshold (20m)
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
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
};

export interface AdaptiveTrackingSnapshot {
  state: AdaptiveTrackingState;
  acquisitionIntervalSec: number;
  transmissionIntervalSec: number;
  displayMessage: string;
  statusLabel: string;
  batterySaving: boolean;
  stationarySinceMs: number | null;
  lastTransmitMs: number;
  speedKmh: number;
}

// Haversine formula (meters)
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6378137.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class AdaptiveTrackingEngine {
  private config: AdaptiveConfig;
  private state: AdaptiveTrackingState = 'MOVING';
  private lastFix: { lat: number; lng: number; timeMs: number } | null = null;
  private stationaryAnchor: { lat: number; lng: number; timeMs: number } | null = null;
  private stationarySinceMs: number | null = null;
  private lastTransmitMs: number = 0;
  private currentSpeedKmh: number = 0;

  constructor(config: Partial<AdaptiveConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
  }

  public reset(): void {
    this.state = 'MOVING';
    this.lastFix = null;
    this.stationaryAnchor = null;
    this.stationarySinceMs = null;
    this.lastTransmitMs = 0;
    this.currentSpeedKmh = 0;
  }

  public getIntervals(state: AdaptiveTrackingState): { acq: number; trans: number; display: string; label: string; batterySaving: boolean } {
    switch (state) {
      case 'MOVING':
        return {
          acq: this.config.movingIntervalSec,
          trans: this.config.movingIntervalSec,
          display: `Updating every ${this.config.movingIntervalSec} seconds`,
          label: 'MOVING',
          batterySaving: false,
        };
      case 'TRAFFIC':
        return {
          acq: this.config.trafficIntervalSec,
          trans: this.config.trafficIntervalSec,
          display: 'Reduced updates — Traffic',
          label: 'SLOW MOVEMENT / TRAFFIC',
          batterySaving: false,
        };
      case 'STATIONARY':
        return {
          acq: this.config.stationaryIntervalSec,
          trans: this.config.stationaryIntervalSec,
          display: `Updating every ${this.config.stationaryIntervalSec} seconds`,
          label: 'STATIONARY',
          batterySaving: false,
        };
      case 'EXTENDED_IDLE':
        return {
          acq: this.config.extendedIdleIntervalSec,
          trans: this.config.extendedIdleIntervalSec,
          display: 'Battery-saving mode',
          label: 'EXTENDED IDLE',
          batterySaving: true,
        };
    }
  }

  /**
   * Process incoming GPS observation and evaluate state transitions with hysteresis & immediate wakeup.
   */
  public processPing(ping: LocationPing): {
    state: AdaptiveTrackingState;
    acquisitionIntervalSec: number;
    transmissionIntervalSec: number;
    batterySaving: boolean;
    displayMessage: string;
    statusLabel: string;
    shouldTransmit: boolean;
  } {
    const nowMs = new Date(ping.timestamp).getTime() || Date.now();
    let speed = ping.speed || 0;
    let displacement = 0;

    if (this.lastFix) {
      displacement = haversineMeters(this.lastFix.lat, this.lastFix.lng, ping.latitude, ping.longitude);
      const dtSec = Math.max((nowMs - this.lastFix.timeMs) / 1000.0, 0.5);

      // In case hardware speed is 0 or missing, calculate displacement-derived speed
      if (speed <= 0 && displacement > 1.0) {
        speed = (displacement / dtSec) * 3.6;
      }
    }

    this.currentSpeedKmh = speed;

    // IMMEDIATE WAKEUP CHECK:
    // If we are currently STATIONARY or EXTENDED_IDLE, check if vehicle started moving
    if (this.state === 'STATIONARY' || this.state === 'EXTENDED_IDLE') {
      let anchorDist = 0;
      if (this.stationaryAnchor) {
        anchorDist = haversineMeters(
          this.stationaryAnchor.lat,
          this.stationaryAnchor.lng,
          ping.latitude,
          ping.longitude
        );
      }

      if (speed >= this.config.movingSpeedKmh || anchorDist >= this.config.wakeupDisplacementMeters) {
        // Immediate restoration to normal tracking
        this.state = 'MOVING';
        this.stationaryAnchor = null;
        this.stationarySinceMs = null;
        this.lastFix = { lat: ping.latitude, lng: ping.longitude, timeMs: nowMs };
        this.lastTransmitMs = nowMs;

        const info = this.getIntervals(this.state);
        return {
          state: this.state,
          acquisitionIntervalSec: info.acq,
          transmissionIntervalSec: info.trans,
          batterySaving: info.batterySaving,
          displayMessage: info.display,
          statusLabel: info.label,
          shouldTransmit: true, // Immediate transmission
        };
      }
    }

    // STATE TRANSITION LOGIC
    if (speed >= this.config.movingSpeedKmh) {
      // Meaningful movement
      this.state = 'MOVING';
      this.stationaryAnchor = null;
      this.stationarySinceMs = null;
    } else if (speed > this.config.trafficSpeedKmh) {
      // Slow movement or stop-and-go traffic
      this.state = 'TRAFFIC';
      this.stationaryAnchor = null;
      this.stationarySinceMs = null;
    } else {
      // Potential stationary condition: speed is very low (<= trafficSpeedKmh)
      if (!this.stationaryAnchor) {
        this.stationaryAnchor = { lat: ping.latitude, lng: ping.longitude, timeMs: nowMs };
        this.stationarySinceMs = nowMs;
        // Keep in TRAFFIC or MOVING until stationary condition persists for threshold duration
        if (this.state === 'MOVING') {
          this.state = 'TRAFFIC';
        }
      } else {
        const anchorDist = haversineMeters(
          this.stationaryAnchor.lat,
          this.stationaryAnchor.lng,
          ping.latitude,
          ping.longitude
        );

        if (anchorDist > this.config.stationaryDisplacementMeters) {
          // Drifted or moved slightly -> reset stationary anchor
          this.stationaryAnchor = { lat: ping.latitude, lng: ping.longitude, timeMs: nowMs };
          this.stationarySinceMs = nowMs;
          this.state = 'TRAFFIC';
        } else {
          // Stays within stationary radius
          const stationaryElapsedSec = (nowMs - (this.stationarySinceMs || nowMs)) / 1000.0;
          if (stationaryElapsedSec >= this.config.extendedIdleDurationSec) {
            this.state = 'EXTENDED_IDLE';
          } else if (stationaryElapsedSec >= this.config.stationaryDurationSec) {
            this.state = 'STATIONARY';
          } else {
            // Still in pre-stationary grace window
            this.state = 'TRAFFIC';
          }
        }
      }
    }

    this.lastFix = { lat: ping.latitude, lng: ping.longitude, timeMs: nowMs };

    // Transmission throttling according to current state interval
    const info = this.getIntervals(this.state);
    const elapsedSinceLastTransmit = (nowMs - this.lastTransmitMs) / 1000.0;

    let shouldTransmit = false;
    if (this.lastTransmitMs === 0 || elapsedSinceLastTransmit >= info.trans) {
      shouldTransmit = true;
      this.lastTransmitMs = nowMs;
    }

    return {
      state: this.state,
      acquisitionIntervalSec: info.acq,
      transmissionIntervalSec: info.trans,
      batterySaving: info.batterySaving,
      displayMessage: info.display,
      statusLabel: info.label,
      shouldTransmit,
    };
  }

  public getSnapshot(): AdaptiveTrackingSnapshot {
    const info = this.getIntervals(this.state);
    return {
      state: this.state,
      acquisitionIntervalSec: info.acq,
      transmissionIntervalSec: info.trans,
      displayMessage: info.display,
      statusLabel: info.label,
      batterySaving: info.batterySaving,
      stationarySinceMs: this.stationarySinceMs,
      lastTransmitMs: this.lastTransmitMs,
      speedKmh: this.currentSpeedKmh,
    };
  }
}

// Global shared engine instance for driver positioning
export const adaptiveEngine = new AdaptiveTrackingEngine();

/**
 * Calculates live connection status, countdown to next expected GPS ping, and stale flags
 * for consumption in the Manager and Public tracking live views.
 */
export function calculateLiveTrackingFreshness(
  lastRecordedAt: string | number | null | undefined,
  intervalSec: number = 5,
  isWebSocketConnected: boolean = true,
  adaptiveState?: AdaptiveTrackingState
): {
  connectionStatus: 'LIVE' | 'LOCATION DELAYED' | 'LOCATION STALE' | 'STATIONARY' | 'RECONNECTING' | 'TRACKING ENDED';
  secondsElapsed: number;
  countdownSec: number;
  isDelayed: boolean;
  isStale: boolean;
  statusBadgeClass: string;
} {
  if (!lastRecordedAt) {
    return {
      connectionStatus: isWebSocketConnected ? 'LIVE' : 'RECONNECTING',
      secondsElapsed: 0,
      countdownSec: intervalSec,
      isDelayed: false,
      isStale: false,
      statusBadgeClass: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    };
  }

  const lastMs = typeof lastRecordedAt === 'number' ? lastRecordedAt : new Date(lastRecordedAt).getTime();
  const nowMs = Date.now();
  const secondsElapsed = Math.max(0, Math.floor((nowMs - lastMs) / 1000.0));

  // Next expected update countdown (clamped to 0)
  const countdownSec = Math.max(0, intervalSec - (secondsElapsed % intervalSec));

  // Tolerance allows for network roundtrip jitter (e.g. interval + 4s)
  const delayedThresholdSec = intervalSec + Math.max(4, Math.floor(intervalSec * 0.4));
  // Freshness threshold is exceeded after 2.5x interval or at least 45s
  const staleThresholdSec = Math.max(intervalSec * 2.5, 45);

  const isDelayed = secondsElapsed > delayedThresholdSec && secondsElapsed <= staleThresholdSec;
  const isStale = secondsElapsed > staleThresholdSec;

  let connectionStatus: 'LIVE' | 'LOCATION DELAYED' | 'LOCATION STALE' | 'STATIONARY' | 'RECONNECTING' | 'TRACKING ENDED' = 'LIVE';
  let statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';

  if (!isWebSocketConnected) {
    connectionStatus = 'RECONNECTING';
    statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200/80';
  } else if (isStale) {
    connectionStatus = 'LOCATION STALE';
    statusBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200/80';
  } else if (isDelayed) {
    connectionStatus = 'LOCATION DELAYED';
    statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200/80';
  } else if (adaptiveState === 'STATIONARY' || adaptiveState === 'EXTENDED_IDLE') {
    connectionStatus = 'STATIONARY';
    statusBadgeClass = 'bg-blue-50 text-[#0071E3] border-blue-200/80';
  }

  return {
    connectionStatus,
    secondsElapsed,
    countdownSec,
    isDelayed,
    isStale,
    statusBadgeClass,
  };
}
