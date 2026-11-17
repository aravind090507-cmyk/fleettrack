import { create } from 'zustand';
import { Journey, LocationPing } from '../types';

interface DriverState {
  currentJourney: Journey | null;
  trackingUrl: string | null;
  trackingToken: string | null;
  driverName: string | null;
  gpsStatus: 'idle' | 'acquiring' | 'active' | 'error' | 'paused';
  lastPing: LocationPing | null;
  isOnline: boolean;
  offlineQueueCount: number;
  journeyDuration: number;

  setDriverName: (name: string) => void;
  setJourney: (journey: Journey | null, trackingUrl?: string, trackingToken?: string, customDriverName?: string) => void;
  setGPSStatus: (status: 'idle' | 'acquiring' | 'active' | 'error' | 'paused') => void;
  setLastPing: (ping: LocationPing | null) => void;
  setOnlineStatus: (isOnline: boolean) => void;
  setOfflineQueueCount: (count: number) => void;
  setJourneyDuration: (seconds: number) => void;
  clearJourney: () => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  currentJourney: null,
  trackingUrl: null,
  trackingToken: null,
  driverName: typeof window !== 'undefined' ? localStorage.getItem('fleet_driver_name') : null,
  gpsStatus: 'idle',
  lastPing: null,
  isOnline: navigator.onLine,
  offlineQueueCount: 0,
  journeyDuration: 0,

  setDriverName: (name: string) => {
    const clean = name ? name.trim() : '';
    if (typeof window !== 'undefined') {
      if (clean) {
        localStorage.setItem('fleet_driver_name', clean);
      } else {
        localStorage.removeItem('fleet_driver_name');
      }
    }
    set({ driverName: clean || null });
  },

  setJourney: (journey, trackingUrl, trackingToken, customDriverName) => {
    const resolvedToken = trackingToken || (journey as any)?.tracking_token || (typeof window !== 'undefined' ? localStorage.getItem('fleet_active_token') : null) || null;
    let resolvedUrl = trackingUrl;
    if (resolvedToken && (!resolvedUrl || resolvedUrl.includes('localhost') || resolvedUrl.startsWith('/'))) {
      resolvedUrl = `${window.location.origin}/track/${resolvedToken}`;
    }
    if (resolvedToken && typeof window !== 'undefined') {
      localStorage.setItem('fleet_active_token', resolvedToken);
    }

    const resolvedDriver = customDriverName || (journey as any)?.driver_name || (typeof window !== 'undefined' ? localStorage.getItem('fleet_driver_name') : null) || null;
    if (resolvedDriver && typeof window !== 'undefined') {
      localStorage.setItem('fleet_driver_name', resolvedDriver);
    }

    set({
      currentJourney: journey,
      trackingUrl: resolvedUrl || null,
      trackingToken: resolvedToken || null,
      driverName: resolvedDriver || null,
      gpsStatus: journey ? 'acquiring' : 'idle',
    });
  },

  setGPSStatus: (gpsStatus) => set({ gpsStatus }),
  setLastPing: (lastPing) => set({ lastPing }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineQueueCount: (offlineQueueCount) => set({ offlineQueueCount }),
  setJourneyDuration: (journeyDuration) => set({ journeyDuration }),

  clearJourney: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet_active_token');
    }
    set({
      currentJourney: null,
      trackingUrl: null,
      trackingToken: null,
      gpsStatus: 'idle',
      lastPing: null,
      journeyDuration: 0,
    });
  },
}));
