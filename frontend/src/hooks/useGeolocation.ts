import { useEffect, useRef, useState, useCallback } from 'react';
import { LocationPing } from '../types';

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
  maxAccuracyMeters?: number;
  simulated?: boolean;
  initialCoords?: { lat: number; lng: number };
  destinationCoords?: { lat: number; lng: number };
  onLocationUpdate?: (ping: LocationPing) => void;
}

// Haversine formula (R = 6,378,137m matching Traccar)
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
  simulated = false,
  initialCoords = { lat: 12.9716, lng: 77.5946 },
  destinationCoords = { lat: 12.9750, lng: 77.5980 },
  onLocationUpdate,
}: UseGeolocationOptions) {
  // Prevent simulation in production builds
  const isProduction = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD;
  const effectiveSimulated = isProduction ? false : simulated;

  const [position, setPosition] = useState<LocationPing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [isSimulatingFallback, setIsSimulatingFallback] = useState<boolean>(false);

  // Store options and callbacks in refs so caller re-renders (e.g. object literals) never recreate handlers
  const optionsRef = useRef({
    enableHighAccuracy,
    maximumAge,
    timeout,
    maxAccuracyMeters,
    simulated: effectiveSimulated,
    initialCoords,
    destinationCoords,
    onLocationUpdate,
  });

  useEffect(() => {
    optionsRef.current = {
      enableHighAccuracy,
      maximumAge,
      timeout,
      maxAccuracyMeters,
      simulated: effectiveSimulated,
      initialCoords,
      destinationCoords,
      onLocationUpdate,
    };
  });

  const watchIdRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<any>(null);
  const simTimerRef = useRef<any>(null);
  const lastTimestampRef = useRef<number>(0);
  const lastFixRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);

  const simCoordsRef = useRef<{ lat: number; lng: number; heading: number }>({
    lat: initialCoords.lat,
    lng: initialCoords.lng,
    heading: 45,
  });

  // Reset or re-arm watchdog (if no fix arrives within 10s, kick GPS with single getCurrentPosition)
  const resetWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(() => {
      if ('geolocation' in navigator && !optionsRef.current.simulated) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            handlePositionRef.current(pos.coords, pos.timestamp);
          },
          (err) => {
            console.debug('Watchdog GPS retry pending:', err.message);
          },
          {
            enableHighAccuracy: optionsRef.current.enableHighAccuracy,
            timeout: 5000,
            maximumAge: optionsRef.current.maximumAge,
          }
        );
        resetWatchdog();
      }
    }, 10000);
  }, []);

  const handlePosition = useCallback((coords: GeolocationCoordinates, timestamp: number) => {
    // 1. Monotonic timestamp check: ignore fixes not strictly newer than previous
    if (timestamp <= lastTimestampRef.current) {
      return;
    }
    lastTimestampRef.current = timestamp;

    // 2. Derive speed from displacement/time if browser speed is null/negative
    let speedKmh = 0;
    if (coords.speed != null && coords.speed >= 0) {
      speedKmh = Math.round(coords.speed * 3.6);
    } else if (lastFixRef.current) {
      const dtSec = (timestamp - lastFixRef.current.timestamp) / 1000;
      if (dtSec > 0.5) {
        const distM = haversineMeters(
          lastFixRef.current.lat,
          lastFixRef.current.lng,
          coords.latitude,
          coords.longitude
        );
        speedKmh = Math.min(Math.round((distM / dtSec) * 3.6), 250);
      }
    }

    lastFixRef.current = {
      lat: coords.latitude,
      lng: coords.longitude,
      timestamp,
    };

    // 3. Do NOT drop low-accuracy fixes on the client: send raw accuracy; the server pipeline decides
    const ping: LocationPing = {
      latitude: parseFloat(coords.latitude.toFixed(6)),
      longitude: parseFloat(coords.longitude.toFixed(6)),
      speed: speedKmh,
      heading: coords.heading != null && coords.heading >= 0 ? Math.round(coords.heading) : 0,
      accuracy: Math.round(coords.accuracy || 10),
      altitude: coords.altitude || null,
      timestamp: new Date(timestamp).toISOString(),
    };

    setPosition(ping);
    setError(null);
    setIsSimulatingFallback(false);

    if (optionsRef.current.onLocationUpdate) {
      optionsRef.current.onLocationUpdate(ping);
    }

    // Acknowledge fix to watchdog
    resetWatchdog();
  }, [resetWatchdog]);

  const handlePositionRef = useRef(handlePosition);
  handlePositionRef.current = handlePosition;

  const startSimulatedMovement = useCallback(() => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    setIsWatching(true);
    setIsSimulatingFallback(true);

    const dest = optionsRef.current.destinationCoords || { lat: 12.9750, lng: 77.5980 };
    const init = optionsRef.current.initialCoords || { lat: 12.9716, lng: 77.5946 };

    simTimerRef.current = setInterval(() => {
      const current = simCoordsRef.current;
      const dLat = dest.lat - current.lat;
      const dLng = dest.lng - current.lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);

      // Correct spherical bearing calculation in radians
      const lat1Rad = current.lat * (Math.PI / 180);
      const lat2Rad = dest.lat * (Math.PI / 180);
      const dLngRad = dLng * (Math.PI / 180);

      const y = Math.sin(dLngRad) * Math.cos(lat2Rad);
      const x =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLngRad);
      let brng = (Math.atan2(y, x) * 180) / Math.PI;
      brng = (brng + 360) % 360;
      current.heading = Math.round(brng);

      // Step ~28 km/h simulated urban transit speed
      const step = 0.00012;
      if (dist > step) {
        current.lat += (dLat / dist) * step;
        current.lng += (dLng / dist) * step;
      } else {
        current.lat = init.lat;
        current.lng = init.lng;
      }

      const ping: LocationPing = {
        latitude: parseFloat(current.lat.toFixed(6)),
        longitude: parseFloat(current.lng.toFixed(6)),
        speed: 28,
        heading: current.heading,
        accuracy: 4.0,
        altitude: 910.0,
        timestamp: new Date().toISOString(),
      };

      setPosition(ping);
      if (optionsRef.current.onLocationUpdate) {
        optionsRef.current.onLocationUpdate(ping);
      }
    }, 1500);
  }, []);

  // Stable startWatching - zero external dependencies to prevent re-subscription churn
  const startWatching = useCallback(() => {
    if (optionsRef.current.simulated) {
      startSimulatedMovement();
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    setIsWatching(true);
    setError(null);

    // Initial immediate single-shot acquisition
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

    // Continuous single watchPosition stream
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

    // Arm watchdog
    resetWatchdog();
  }, [resetWatchdog, startSimulatedMovement]);

  // Stable stopWatching
  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (simTimerRef.current !== null) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
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
    isSimulating: effectiveSimulated,
    startWatching,
    stopWatching,
  };
}
