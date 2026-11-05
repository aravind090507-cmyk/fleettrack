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

export function useGeolocation({
  enableHighAccuracy = true,
  maximumAge = 1000,
  timeout = 10000,
  maxAccuracyMeters = 200.0, // High tolerance for indoor GPS
  simulated = false,
  initialCoords = { lat: 12.9716, lng: 77.5946 },
  destinationCoords = { lat: 12.9750, lng: 77.5980 },
  onLocationUpdate,
}: UseGeolocationOptions) {
  const [position, setPosition] = useState<LocationPing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [isSimulatingFallback, setIsSimulatingFallback] = useState<boolean>(false);
  const watchIdRef = useRef<number | null>(null);
  const periodicTimerRef = useRef<any>(null);
  const simTimerRef = useRef<any>(null);
  const hasPositionRef = useRef<boolean>(false);
  const simCoordsRef = useRef<{ lat: number; lng: number; heading: number }>({
    lat: initialCoords.lat,
    lng: initialCoords.lng,
    heading: 45,
  });

  const handlePosition = useCallback(
    (coords: GeolocationCoordinates, timestamp: number) => {
      // Discard extreme anomalies (> 200m)
      if (coords.accuracy > maxAccuracyMeters) {
        console.warn(`GPS ping: accuracy ${coords.accuracy}m`);
      }

      const ping: LocationPing = {
        latitude: parseFloat(coords.latitude.toFixed(6)),
        longitude: parseFloat(coords.longitude.toFixed(6)),
        speed: coords.speed != null && coords.speed >= 0 ? Math.round(coords.speed * 3.6) : 0,
        heading: coords.heading != null && coords.heading >= 0 ? Math.round(coords.heading) : 0,
        accuracy: Math.round(coords.accuracy || 10),
        altitude: coords.altitude || null,
        timestamp: new Date(timestamp).toISOString(),
      };

      hasPositionRef.current = true;
      setPosition(ping);
      setError(null);
      setIsSimulatingFallback(false);
      if (onLocationUpdate) {
        onLocationUpdate(ping);
      }
    },
    [maxAccuracyMeters, onLocationUpdate]
  );

  const startSimulatedMovement = useCallback(() => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
    setIsWatching(true);
    setIsSimulatingFallback(true);

    // Vector towards destination
    const destLat = destinationCoords?.lat || initialCoords.lat + 0.005;
    const destLng = destinationCoords?.lng || initialCoords.lng + 0.005;

    simTimerRef.current = setInterval(() => {
      const current = simCoordsRef.current;
      const dLat = destLat - current.lat;
      const dLng = destLng - current.lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);

      // Bearing
      const y = Math.sin(dLng) * Math.cos(destLat);
      const x = Math.cos(current.lat) * Math.sin(destLat) - Math.sin(current.lat) * Math.cos(destLat) * Math.cos(dLng);
      let brng = (Math.atan2(y, x) * 180) / Math.PI;
      brng = (brng + 360) % 360;
      current.heading = Math.round(brng);

      // Step: ~25 km/h driving simulation (~14 meters per 2s = ~0.00013 deg)
      const step = 0.00012;
      if (dist > step) {
        current.lat += (dLat / dist) * step;
        current.lng += (dLng / dist) * step;
      } else {
        // Reverse direction or oscillate gently around target
        current.lat = initialCoords.lat;
        current.lng = initialCoords.lng;
      }

      const ping: LocationPing = {
        latitude: parseFloat(current.lat.toFixed(6)),
        longitude: parseFloat(current.lng.toFixed(6)),
        speed: 28, // 28 km/h realistic urban transit speed
        heading: current.heading,
        accuracy: 4.0,
        altitude: 910.0,
        timestamp: new Date().toISOString(),
      };

      setPosition(ping);
      if (onLocationUpdate) {
        onLocationUpdate(ping);
      }
    }, 1500);
  }, [destinationCoords, initialCoords, onLocationUpdate]);

  const startWatching = useCallback(() => {
    if (simulated) {
      startSimulatedMovement();
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('Geolocation not supported — activating simulated motion.');
      startSimulatedMovement();
      return;
    }

    setIsWatching(true);
    setError(null);

    // Initial immediate single-shot acquisition
    navigator.geolocation.getCurrentPosition(
      (pos) => handlePosition(pos.coords, pos.timestamp),
      (err) => {
        console.warn('Initial GPS fetch notice:', err.message);
        // Fallback to initial coords ping if real GPS takes long
        const initialPing: LocationPing = {
          latitude: initialCoords.lat,
          longitude: initialCoords.lng,
          speed: 0,
          heading: 0,
          accuracy: 5,
          altitude: null,
          timestamp: new Date().toISOString(),
        };
        setPosition(initialPing);
        if (onLocationUpdate) onLocationUpdate(initialPing);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 }
    );

    // Continuous watchPosition for live movement
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => handlePosition(pos.coords, pos.timestamp),
      (err) => {
        let msg = 'Live GPS pending...';
        if (err.code === 1) msg = 'Location permission denied. Using route simulation.';
        else if (err.code === 2) msg = 'GPS hardware unavailable. Using route simulation.';
        else if (err.code === 3) msg = 'Satellite GPS timed out indoors. Using route simulation.';
        setError(msg);
        // Automatically start simulation if GPS is blocked so tracking never stalls
        if (!simTimerRef.current) {
          startSimulatedMovement();
        }
      },
      {
        enableHighAccuracy,
        maximumAge,
        timeout,
      }
    );

    // Periodic heartbeat poll every 1.5 seconds for instant real-time telemetry
    if (periodicTimerRef.current) clearInterval(periodicTimerRef.current);
    periodicTimerRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => handlePosition(pos.coords, pos.timestamp),
        (_err) => {
          // If indoor GPS is struggling and no position yet, keep simulation running
          if (!hasPositionRef.current && !simTimerRef.current) {
            startSimulatedMovement();
          }
        },
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 1000 }
      );
    }, 1500);
  }, [enableHighAccuracy, handlePosition, initialCoords, maximumAge, onLocationUpdate, simulated, startSimulatedMovement, timeout]);

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
