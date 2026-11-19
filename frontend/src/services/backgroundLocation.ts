import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { LocationPing, AdaptiveTrackingState } from '../types';
import { AdaptiveTrackingSnapshot } from './adaptiveTracking';

export interface StartTrackingOptions {
  journeyId: string;
  token: string;
  apiBaseUrl: string;
  vehicleReg?: string;
  destination?: string;
  intervalSec?: number;
  adaptiveState?: AdaptiveTrackingState;
  statusLabel?: string;
  batterySaving?: boolean;
}

export interface NativePermissionStatus {
  fineLocation: boolean;
  backgroundLocation: boolean;
  notifications: boolean;
  ignoringBatteryOptimizations: boolean;
  allGranted: boolean;
}

interface BackgroundLocationPluginInterface {
  startTracking(options: StartTrackingOptions): Promise<{ success: boolean; isTracking: boolean }>;
  stopTracking(): Promise<{ success: boolean; isTracking: boolean }>;
  updateAdaptiveState(options: {
    intervalSec: number;
    adaptiveState: string;
    statusLabel: string;
    batterySaving: boolean;
  }): Promise<{ success: boolean }>;
  getTrackingStatus(): Promise<{ isTracking: boolean }>;
  checkPermissionsStatus(): Promise<NativePermissionStatus>;
  requestAllPermissions(): Promise<NativePermissionStatus>;
  requestBackgroundLocationPermission(): Promise<{ requested: boolean }>;
  checkBatteryOptimizations(): Promise<{ ignoringBatteryOptimizations: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ success: boolean }>;
  addListener(
    eventName: 'onLocationUpdate',
    listenerFunc: (ping: LocationPing) => void
  ): Promise<PluginListenerHandle>;
}

const BackgroundLocationNative = registerPlugin<BackgroundLocationPluginInterface>('BackgroundLocation');

export class BackgroundLocationService {
  private listenerHandle: PluginListenerHandle | null = null;
  private isTrackingActive: boolean = false;

  public isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  public async checkPermissions(): Promise<NativePermissionStatus> {
    if (!this.isNativeAndroid()) {
      return {
        fineLocation: true,
        backgroundLocation: false,
        notifications: true,
        ignoringBatteryOptimizations: true,
        allGranted: true,
      };
    }
    try {
      return await BackgroundLocationNative.checkPermissionsStatus();
    } catch (e) {
      console.warn('[BackgroundLocation] checkPermissions failed:', e);
      return {
        fineLocation: false,
        backgroundLocation: false,
        notifications: false,
        ignoringBatteryOptimizations: false,
        allGranted: false,
      };
    }
  }

  public async requestPermissions(): Promise<NativePermissionStatus> {
    if (!this.isNativeAndroid()) {
      return this.checkPermissions();
    }
    try {
      return await BackgroundLocationNative.requestAllPermissions();
    } catch (e) {
      console.warn('[BackgroundLocation] requestPermissions failed:', e);
      return this.checkPermissions();
    }
  }

  public async requestBackgroundLocation(): Promise<void> {
    if (!this.isNativeAndroid()) return;
    try {
      await BackgroundLocationNative.requestBackgroundLocationPermission();
    } catch (e) {
      console.warn('[BackgroundLocation] requestBackgroundLocation failed:', e);
    }
  }

  public async checkBatteryOptimizations(): Promise<boolean> {
    if (!this.isNativeAndroid()) return true;
    try {
      const res = await BackgroundLocationNative.checkBatteryOptimizations();
      return res.ignoringBatteryOptimizations;
    } catch {
      return true;
    }
  }

  public async requestIgnoreBatteryOptimizations(): Promise<void> {
    if (!this.isNativeAndroid()) return;
    try {
      await BackgroundLocationNative.requestIgnoreBatteryOptimizations();
    } catch (e) {
      console.warn('[BackgroundLocation] requestIgnoreBatteryOptimizations failed:', e);
    }
  }

  public async startTracking(options: StartTrackingOptions): Promise<boolean> {
    if (!this.isNativeAndroid()) {
      this.isTrackingActive = true;
      return true;
    }
    try {
      const res = await BackgroundLocationNative.startTracking({
        journeyId: options.journeyId,
        token: options.token,
        apiBaseUrl: options.apiBaseUrl,
        vehicleReg: options.vehicleReg || 'VAN-01',
        destination: options.destination || 'Delivery Location',
        intervalSec: options.intervalSec || 5,
        adaptiveState: options.adaptiveState || 'MOVING',
        statusLabel: options.statusLabel || 'MOVING',
        batterySaving: options.batterySaving || false,
      });
      this.isTrackingActive = res.isTracking;
      return res.success;
    } catch (e) {
      console.error('[BackgroundLocation] Failed to start native tracking:', e);
      return false;
    }
  }

  public async stopTracking(): Promise<boolean> {
    if (!this.isNativeAndroid()) {
      this.isTrackingActive = false;
      return true;
    }
    try {
      const res = await BackgroundLocationNative.stopTracking();
      this.isTrackingActive = res.isTracking;
      return res.success;
    } catch (e) {
      console.error('[BackgroundLocation] Failed to stop native tracking:', e);
      return false;
    }
  }

  public async updateAdaptiveState(snapshot: AdaptiveTrackingSnapshot): Promise<void> {
    if (!this.isNativeAndroid() || !this.isTrackingActive) return;
    try {
      await BackgroundLocationNative.updateAdaptiveState({
        intervalSec: snapshot.acquisitionIntervalSec,
        adaptiveState: snapshot.state,
        statusLabel: snapshot.statusLabel,
        batterySaving: snapshot.batterySaving,
      });
    } catch (e) {
      console.warn('[BackgroundLocation] Failed to sync adaptive state with native service:', e);
    }
  }

  public async getTrackingStatus(): Promise<boolean> {
    if (!this.isNativeAndroid()) return this.isTrackingActive;
    try {
      const res = await BackgroundLocationNative.getTrackingStatus();
      this.isTrackingActive = res.isTracking;
      return res.isTracking;
    } catch {
      return this.isTrackingActive;
    }
  }

  public async addLocationListener(callback: (ping: LocationPing) => void): Promise<() => void> {
    if (!this.isNativeAndroid()) {
      return () => {};
    }
    try {
      this.listenerHandle = await BackgroundLocationNative.addListener('onLocationUpdate', (ping: LocationPing) => {
        callback(ping);
      });
      return () => {
        if (this.listenerHandle) {
          this.listenerHandle.remove();
          this.listenerHandle = null;
        }
      };
    } catch (e) {
      console.warn('[BackgroundLocation] addListener failed:', e);
      return () => {};
    }
  }
}

export const backgroundLocation = new BackgroundLocationService();
