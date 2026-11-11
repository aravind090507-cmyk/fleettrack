import { useEffect, useRef, useState, useCallback } from 'react';
import { LocationPing } from '../types';

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
  maxAccuracyMeters?: number;
  onLocationUpdate?: (ping: LocationPing) => void;
}

// Haversine formula (R = 6,378,137m matching telematics pipeline)
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6378137.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function useGeolocation({
  enableHighAccuracy = true,
  maximumAge = 1000,
  timeout = 10000,
  maxAccuracyMeters = 200.0,
  onLocationUpdate,
}: UseGeolocationOptions = {}) {
  const [position, setPosition] = useState<LocationPing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState<boolean>(false);

  const optionsRef = useRef({
    enableHighAccuracy,
    maximumAge,
    timeout,
    maxAccuracyMeters,
    onLocationUpdate,
  });

  useEffect(() => {
    optionsRef.current = {
      enableHighAccuracy,
      maximumAge,
      timeout,
      maxAccuracyMeters,
      onLocationUpdate,
    };
  });

  const watchIdRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<any>(null);
  const lastTimestampRef = useRef<number>(0);
  const lastFixRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);

  const resetWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
    }
    watchdogTimerRef.current = setTimeout(() => {
      setError('GPS signal lock lost. Retrying satellite fix...');
    }, 15000);
  }, []);

  const handlePosition = useCallback(
    (coords: GeolocationCoordinates, timestamp: number) => {
      setError(null);

      // Monotonic clock skew & out-of-order defense
      if (timestamp <= lastTimestampRef.current && lastTimestampRef.current !== 0) {
        return;
      }
      lastTimestampRef.current = timestamp;

      // Filter erratic GPS fixes with poor horizontal accuracy
      const acc = coords.accuracy || 10.0;
      if (acc > optionsRef.current.maxAccuracyMeters) {
        return;
      }

      // Dynamic motion detection & stationary jitter suppression (1.5m radius)
      let derivedSpeedKmh = coords.speed !== null && coords.speed !== undefined && !isNaN(coords.speed)
        ? Math.round(coords.speed * 3.6)
        : 0;

      if (lastFixRef.current) {
        const dtSec = Math.max((timestamp - lastFixRef.current.timestamp) / 1000.0, 0.001);
        const distM = haversineMeters(
          lastFixRef.current.lat,
          lastFixRef.current.lng,
          coords.latitude,
          coords.longitude
        );

        // Doppler dead-reckoning fallback if hardware speed is unavailable
        if (coords.speed === null || coords.speed === undefined || isNaN(coords.speed)) {
          derivedSpeedKmh = Math.round((distM / dtSec) * 3.6);
        }

        // Stationary clamp: jitter under 1.5m is snapped to 0 speed
        if (distM < 1.5 && derivedSpeedKmh < 3) {
          derivedSpeedKmh = 0;
        }
      }

      lastFixRef.current = {
        lat: coords.latitude,
        lng: coords.longitude,
        timestamp,
      };

      const ping: LocationPing = {
        latitude: parseFloat(coords.latitude.toFixed(6)),
        longitude: parseFloat(coords.longitude.toFixed(6)),
        speed: derivedSpeedKmh,
        heading: coords.heading !== null && !isNaN(coords.heading) ? Math.round(coords.heading) : 0,
        accuracy: Math.round(acc * 10) / 10,
        altitude: coords.altitude !== null && !isNaN(coords.altitude) ? Math.round(coords.altitude * 10) / 10 : undefined,
        timestamp: new Date(timestamp).toISOString(),
      };

      setPosition(ping);

      if (optionsRef.current.onLocationUpdate) {
        optionsRef.current.onLocationUpdate(ping);
      }

      resetWatchdog();
    },
    [resetWatchdog]
  );

  const handlePositionRef = useRef(handlePosition);
  handlePositionRef.current = handlePosition;

  const startWatching = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    setIsWatching(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => handlePositionRef.current(pos.coords, pos.timestamp),
      (err) => {
        let msg = 'Live GPS pending...';
        if (err.code === 1) msg = 'Location permission denied. Please enable GPS permission.';
        else if (err.code === 2) msg = 'GPS hardware unavailable. Ensure location services are active.';
        else if (err.code === 3) msg = 'Acquiring satellite fix...';
        setError(msg);
      },
      {
        enableHighAccuracy: optionsRef.current.enableHighAccuracy,
        timeout: optionsRef.current.timeout,
        maximumAge: optionsRef.current.maximumAge,
      }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handlePositionRef.current(pos.coords, pos.timestamp),
      (err) => {
        let msg = 'Live GPS pending...';
        if (err.code === 1) msg = 'Location permission denied. Please grant GPS permissions.';
        else if (err.code === 2) msg = 'GPS signal lost or unavailable.';
        else if (err.code === 3) msg = 'GPS satellite lock timed out.';
        setError(msg);
      },
      {
        enableHighAccuracy: optionsRef.current.enableHighAccuracy,
        maximumAge: optionsRef.current.maximumAge,
        timeout: optionsRef.current.timeout,
      }
    );

    resetWatchdog();
  }, [resetWatchdog]);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    setIsWatching(false);
  }, []);

  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, [stopWatching]);

  return {
    position,
    error,
    isWatching,
    startWatching,
    stopWatching,
  };
}
