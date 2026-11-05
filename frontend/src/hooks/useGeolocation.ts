import { useEffect, useRef, useState, useCallback } from 'react';
import { LocationPing } from '../types';

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
  maxAccuracyMeters?: number;
  simulated?: boolean;
  initialCoords?: { lat: number; lng: number };
  onLocationUpdate?: (ping: LocationPing) => void;
}

export function useGeolocation({
  enableHighAccuracy = true,
  maximumAge = 0,
  timeout = 7000,
  maxAccuracyMeters = 150.0, // High tolerance for indoor office GPS
  simulated = false,
  initialCoords = { lat: 12.9716, lng: 77.5946 },
  onLocationUpdate,
}: UseGeolocationOptions) {
  const [position, setPosition] = useState<LocationPing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const watchIdRef = useRef<number | null>(null);
  const periodicTimerRef = useRef<any>(null);
  const simTimerRef = useRef<any>(null);
  const simCoordsRef = useRef<{ lat: number; lng: number; heading: number }>({
    lat: initialCoords.lat,
    lng: initialCoords.lng,
    heading: 90,
  });

  const handlePosition = useCallback(
    (coords: GeolocationCoordinates, timestamp: number) => {
      // Discard only extreme anomalies (> 150m) to preserve indoor office walking
      if (coords.accuracy > maxAccuracyMeters) {
        console.warn(`GPS ping: accuracy ${coords.accuracy}m`);
      }

      const ping: LocationPing = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed != null && coords.speed >= 0 ? Math.round(coords.speed * 3.6) : 0,
        heading: coords.heading != null && coords.heading >= 0 ? Math.round(coords.heading) : 0,
        accuracy: Math.round(coords.accuracy || 10),
        altitude: coords.altitude || null,
        timestamp: new Date(timestamp).toISOString(),
      };

      setPosition(ping);
      setError(null);
      if (onLocationUpdate) {
        onLocationUpdate(ping);
      }
    },
    [maxAccuracyMeters, onLocationUpdate]
  );

  const startSimulatedMovement = useCallback(() => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    setIsWatching(true);
    setError(null);

    // Micro-movement step simulator (walking pace: ~1-2 meters every 2 seconds)
    simTimerRef.current = setInterval(() => {
      const current = simCoordsRef.current;
      // 0.00001 degrees lat is approx 1.1 meters!
      const latDelta = 0.000015;
      const lngDelta = 0.000010;
      current.lat += latDelta;
      current.lng += lngDelta;
      current.heading = 45;

      const ping: LocationPing = {
        latitude: parseFloat(current.lat.toFixed(6)),
        longitude: parseFloat(current.lng.toFixed(6)),
        speed: 3, // 3 km/h gentle walk
        heading: current.heading,
        accuracy: 4.0,
        altitude: 800.0,
        timestamp: new Date().toISOString(),
      };

      setPosition(ping);
      if (onLocationUpdate) {
        onLocationUpdate(ping);
      }
    }, 2000);
  }, [onLocationUpdate]);

  const startWatching = useCallback(() => {
    if (simulated) {
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
      (pos) => handlePosition(pos.coords, pos.timestamp),
      (err) => console.warn('Initial GPS fetch error:', err.message),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    // Continuous watchPosition for walking tracking
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handlePosition(pos.coords, pos.timestamp),
      (err) => {
        let msg = 'Failed to acquire GPS position.';
        if (err.code === 1) msg = 'Location permission denied. Please allow GPS access in settings.';
        else if (err.code === 2) msg = 'GPS position unavailable. Ensure device location is turned ON.';
        else if (err.code === 3) msg = 'GPS acquisition timed out. Re-acquiring...';
        setError(msg);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout,
      }
    );

    // Active polling interval fallback every 2.5s (vital for indoor walking where watchPosition throttles)
    if (periodicTimerRef.current) clearInterval(periodicTimerRef.current);
    periodicTimerRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => handlePosition(pos.coords, pos.timestamp),
        (err) => console.debug('Periodic GPS poll:', err.message),
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
      );
    }, 2500);
  }, [handlePosition, simulated, startSimulatedMovement, timeout]);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (periodicTimerRef.current !== null) {
      clearInterval(periodicTimerRef.current);
      periodicTimerRef.current = null;
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
    startWatching,
    stopWatching,
  };
}
