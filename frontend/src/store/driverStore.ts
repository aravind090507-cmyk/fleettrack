import { create } from 'zustand';
import { Journey, LocationPing } from '../types';

interface DriverState {
  currentJourney: Journey | null;
  trackingUrl: string | null;
  trackingToken: string | null;
  gpsStatus: 'idle' | 'acquiring' | 'active' | 'error' | 'paused';
  lastPing: LocationPing | null;
  isOnline: boolean;
  offlineQueueCount: number;
  journeyDuration: number;
  simulatedMode: boolean;

  setJourney: (journey: Journey | null, trackingUrl?: string, trackingToken?: string) => void;
  setGPSStatus: (status: 'idle' | 'acquiring' | 'active' | 'error' | 'paused') => void;
  setLastPing: (ping: LocationPing | null) => void;
  setOnlineStatus: (isOnline: boolean) => void;
  setOfflineQueueCount: (count: number) => void;
  setJourneyDuration: (seconds: number) => void;
  toggleSimulatedMode: () => void;
  clearJourney: () => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  currentJourney: null,
  trackingUrl: null,
  trackingToken: null,
  gpsStatus: 'idle',
  lastPing: null,
  isOnline: navigator.onLine,
  offlineQueueCount: 0,
  journeyDuration: 0,
  simulatedMode: false,

  setJourney: (journey, trackingUrl, trackingToken) => {
    const resolvedToken = trackingToken || (journey as any)?.tracking_token || localStorage.getItem('fleet_active_token') || null;
    let resolvedUrl = trackingUrl;
    if (resolvedToken && (!resolvedUrl || resolvedUrl.includes('localhost') || resolvedUrl.startsWith('/'))) {
      resolvedUrl = `${window.location.origin}/track/${resolvedToken}`;
    }
    if (resolvedToken) {
      localStorage.setItem('fleet_active_token', resolvedToken);
    }
    set({
      currentJourney: journey,
      trackingUrl: resolvedUrl || null,
      trackingToken: resolvedToken || null,
      gpsStatus: journey ? 'acquiring' : 'idle',
    });
  },

  setGPSStatus: (gpsStatus) => set({ gpsStatus }),
  setLastPing: (lastPing) => set({ lastPing }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
  setOfflineQueueCount: (offlineQueueCount) => set({ offlineQueueCount }),
  setJourneyDuration: (journeyDuration) => set({ journeyDuration }),
  toggleSimulatedMode: () => set((state) => ({ simulatedMode: !state.simulatedMode })),

  clearJourney: () => {
    localStorage.removeItem('fleet_active_token');
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
