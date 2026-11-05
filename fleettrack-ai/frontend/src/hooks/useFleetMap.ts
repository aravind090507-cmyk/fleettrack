import { useState, useEffect, useRef } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { darkMapStyle } from '../utils/mapUtils';

export function useFleetMap() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaderRef = useRef<Loader | null>(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || '';
  const hasApiKey = Boolean(apiKey && apiKey.trim().length > 0 && apiKey !== 'YOUR_GOOGLE_MAPS_BROWSER_API_KEY');

  useEffect(() => {
    if (!hasApiKey) {
      setLoadError(
        'Google Maps API key not configured. Please set VITE_GOOGLE_MAPS_BROWSER_KEY in your .env file.'
      );
      return;
    }

    if (window.google && window.google.maps) {
      setIsLoaded(true);
      return;
    }

    if (!loaderRef.current) {
      loaderRef.current = new Loader({
        apiKey,
        version: 'weekly',
        libraries: ['places', 'geometry'],
      });
    }

    loaderRef.current
      .load()
      .then(() => {
        setIsLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load Google Maps script:', err);
        setLoadError('Failed to load Google Maps API.');
      });
  }, [apiKey, hasApiKey]);

  const createMap = (
    container: HTMLElement,
    options?: google.maps.MapOptions
  ): google.maps.Map | null => {
    if (!window.google || !window.google.maps) return null;

    const defaultOptions: google.maps.MapOptions = {
      center: { lat: 37.7749, lng: -122.4194 }, // Default San Francisco coordinates
      zoom: 12,
      styles: darkMapStyle,
      disableDefaultUI: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      backgroundColor: '#0f172a',
      ...options,
    };

    return new google.maps.Map(container, defaultOptions);
  };

  return {
    isLoaded,
    loadError,
    hasApiKey,
    createMap,
  };
}

export default useFleetMap;
