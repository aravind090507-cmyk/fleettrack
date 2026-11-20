import { useState, useEffect, useCallback, useRef } from 'react';
import { useDriverStore, LocationPermissionState, LastKnownCoords } from '../store/driverStore';

export type LocationStatusDisplay =
  | 'LOCATION PERMISSION REQUIRED'
  | 'LOCATION ENABLED'
  | 'LOCATION UNAVAILABLE'
  | 'TURN ON DEVICE LOCATION'
  | 'LOCATION ACCESS DENIED'
  | 'LIVE GPS TRACKING';

export function useLocationPermission() {
  const {
    currentJourney,
    locationPermission,
    lastKnownLocation,
    setLocationPermission,
    setLastKnownLocation,
    setLastPing,
  } = useDriverStore();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);
  const autoCheckedRef = useRef<boolean>(false);

  // Compute exact status display according to the requirement table
  let statusDisplay: LocationStatusDisplay = 'LOCATION PERMISSION REQUIRED';

  if (currentJourney && currentJourney.status === 'IN_PROGRESS' && locationPermission === 'granted') {
    statusDisplay = 'LIVE GPS TRACKING';
  } else if (locationPermission === 'granted') {
    statusDisplay = 'LOCATION ENABLED';
  } else if (locationPermission === 'denied') {
    statusDisplay = 'LOCATION ACCESS DENIED';
  } else if (locationPermission === 'device_disabled') {
    statusDisplay = 'TURN ON DEVICE LOCATION';
  } else if (locationPermission === 'unavailable') {
    statusDisplay = 'LOCATION UNAVAILABLE';
  } else {
    statusDisplay = 'LOCATION PERMISSION REQUIRED';
  }

  const acquirePosition = useCallback(
    (interactive: boolean = false) => {
      if (typeof window === 'undefined' || !('geolocation' in navigator)) {
        setLocationPermission('unavailable');
        setErrorMessage('Geolocation is not supported by your browser.');
        return;
      }

      setIsRetrying(true);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setIsRetrying(false);
          const coords: LastKnownCoords = {
            latitude: parseFloat(pos.coords.latitude.toFixed(6)),
            longitude: parseFloat(pos.coords.longitude.toFixed(6)),
            accuracy: Math.round((pos.coords.accuracy || 10) * 10) / 10,
            heading: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? Math.round(pos.coords.heading) : 0,
            speed: pos.coords.speed !== null && !isNaN(pos.coords.speed) ? Math.round(pos.coords.speed * 3.6) : 0,
            timestamp: new Date(pos.timestamp).toISOString(),
          };

          setLocationPermission('granted');
          setLastKnownLocation(coords);
          setErrorMessage(null);

          // Update initial location in store for immediate use by JourneySetup
          setLastPing({
            latitude: coords.latitude,
            longitude: coords.longitude,
            speed: coords.speed || 0,
            heading: coords.heading || 0,
            accuracy: coords.accuracy,
            timestamp: coords.timestamp,
          });
        },
        (err: GeolocationPositionError) => {
          setIsRetrying(false);
          const msgLower = (err.message || '').toLowerCase();

          if (err.code === 1) {
            // PERMISSION_DENIED: User explicitly blocked or system policy denied
            setLocationPermission('denied');
            setErrorMessage(
              'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
            );
          } else if (err.code === 2 || msgLower.includes('disabled') || msgLower.includes('turned off') || msgLower.includes('provider')) {
            // POSITION_UNAVAILABLE: Device location services / GPS hardware turned off
            setLocationPermission('device_disabled');
            setErrorMessage(
              'Your device location is turned off. Please enable GPS/location services and try again.'
            );
          } else if (err.code === 3) {
            // TIMEOUT: GPS acquisition timed out
            setLocationPermission('unavailable');
            setErrorMessage('GPS satellite lock timed out. Searching for satellite fix...');
          } else {
            setLocationPermission('unavailable');
            setErrorMessage(err.message || 'GPS location is temporarily unavailable.');
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    },
    [setLocationPermission, setLastKnownLocation, setLastPing]
  );

  const queryOrRequest = useCallback(
    async (interactive: boolean = false) => {
      if (typeof window === 'undefined') return;

      if (!('geolocation' in navigator)) {
        setLocationPermission('unavailable');
        setErrorMessage('Geolocation is not supported by your browser.');
        return;
      }

      // Check Permissions API when available (Android Chrome, Edge, modern browsers)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const pStatus = await navigator.permissions.query({ name: 'geolocation' });
          permissionStatusRef.current = pStatus;

          pStatus.onchange = () => {
            if (pStatus.state === 'granted') {
              setLocationPermission('granted');
              setErrorMessage(null);
              acquirePosition(false);
            } else if (pStatus.state === 'denied') {
              setLocationPermission('denied');
              setErrorMessage(
                'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
              );
            } else {
              setLocationPermission('prompt');
              setErrorMessage(
                'Location access is required for vehicle tracking. Please grant browser permission to continue.'
              );
            }
          };

          if (pStatus.state === 'granted') {
            setLocationPermission('granted');
            setErrorMessage(null);
            acquirePosition(false);
            return;
          } else if (pStatus.state === 'denied') {
            setLocationPermission('denied');
            setErrorMessage(
              'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
            );
            if (!interactive) return; // Do not repeatedly trigger permission prompt without user action
          } else {
            // state === 'prompt': prompt not yet decided
            setLocationPermission('prompt');
            setErrorMessage(
              'Location access is required for vehicle tracking. Please grant browser permission to continue.'
            );
          }
        } catch (e) {
          // Fallback for Safari / platforms where permissions.query throws
          console.debug('navigator.permissions.query fallback:', e);
        }
      }

      // Trigger native browser permission prompt / acquire position
      acquirePosition(interactive);
    },
    [acquirePosition, setLocationPermission]
  );

  // Automatic execution once upon Driver Portal entry / mount
  useEffect(() => {
    if (!autoCheckedRef.current) {
      autoCheckedRef.current = true;
      queryOrRequest(false);
    }
  }, [queryOrRequest]);

  return {
    state: locationPermission,
    statusDisplay,
    coords: lastKnownLocation,
    errorMessage,
    requestPermission: () => queryOrRequest(true),
    isRetrying,
  };
}
