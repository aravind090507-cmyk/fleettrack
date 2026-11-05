import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Vehicle, VehicleLocation, Geofence } from '../../types';
import { useFleetMap } from '../../hooks/useFleetMap';
import { VehicleMarkerManager } from './VehicleMarker';
import { RoutePolylineManager } from './RoutePolyline';
import { getStatusColor, formatVehicleType, formatSpeed, formatRelativeTime } from '../../utils/formatters';
import { Maximize2, MapPin, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

export interface FleetMapProps {
  vehicles: Vehicle[];
  locations: Record<string, VehicleLocation>;
  selectedVehicleIds?: string[];
  onVehicleSelect?: (vehicleId: string) => void;
  showRoute?: { vehicleId?: string; coordinates: [number, number][] } | null;
  geofences?: Geofence[];
  height?: string;
  className?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  interactiveFallback?: boolean;
}

export function FleetMap({
  vehicles = [],
  locations = {},
  selectedVehicleIds = [],
  onVehicleSelect,
  showRoute,
  geofences = [],
  height = '100%',
  className = '',
  center,
  zoom = 12,
}: FleetMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, VehicleMarkerManager>>(new Map());
  const routeManagerRef = useRef<RoutePolylineManager | null>(null);
  const geofenceOverlaysRef = useRef<(google.maps.Circle | google.maps.Polygon)[]>([]);

  const { isLoaded, loadError, hasApiKey, createMap } = useFleetMap();
  const [selectedMockVehicle, setSelectedMockVehicle] = useState<Vehicle | null>(null);

  // Initialize Google Map
  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = center || { lat: 37.7749, lng: -122.4194 };
    const map = createMap(mapContainerRef.current, {
      center: initialCenter,
      zoom,
    });

    if (map) {
      mapInstanceRef.current = map;
      routeManagerRef.current = new RoutePolylineManager(map);
    }

    return () => {
      // Cleanup all markers
      markersRef.current.forEach((m) => m.destroy());
      markersRef.current.clear();
      geofenceOverlaysRef.current.forEach((o) => o.setMap(null));
      geofenceOverlaysRef.current = [];
      mapInstanceRef.current = null;
    };
  }, [isLoaded, createMap, center, zoom]);

  // Sync Vehicle Markers with locations
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const currentMarkerMap = markersRef.current;
    const activeVehicleIds = new Set(vehicles.map((v) => v.id));

    // Remove deleted vehicles
    currentMarkerMap.forEach((manager, id) => {
      if (!activeVehicleIds.has(id)) {
        manager.destroy();
        currentMarkerMap.delete(id);
      }
    });

    // Create or update markers
    vehicles.forEach((vehicle) => {
      const loc = locations[vehicle.id] || vehicle.latest_location;
      if (!loc || !loc.latitude || !loc.longitude) return;

      const isSelected = selectedVehicleIds.includes(vehicle.id);
      const existingMarker = currentMarkerMap.get(vehicle.id);

      if (existingMarker) {
        existingMarker.updateVehicle(vehicle);
        existingMarker.setSelected(isSelected);
        existingMarker.animateTo(loc, 4000);
      } else {
        const newManager = new VehicleMarkerManager(
          map,
          vehicle,
          loc,
          isSelected,
          (id) => onVehicleSelect?.(id)
        );
        currentMarkerMap.set(vehicle.id, newManager);
      }
    });
  }, [vehicles, locations, selectedVehicleIds, isLoaded, onVehicleSelect]);

  // Center on selected vehicle if one is single-selected
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current) return;
    if (selectedVehicleIds.length === 1) {
      const selectedId = selectedVehicleIds[0];
      const loc = locations[selectedId] || vehicles.find((v) => v.id === selectedId)?.latest_location;
      if (loc && loc.latitude && loc.longitude) {
        mapInstanceRef.current.panTo({ lat: loc.latitude, lng: loc.longitude });
        const marker = markersRef.current.get(selectedId);
        if (marker) {
          marker.showInfoWindow();
        }
      }
    }
  }, [selectedVehicleIds, isLoaded, locations, vehicles]);

  // Draw Route History Polyline
  useEffect(() => {
    if (!isLoaded || !routeManagerRef.current) return;

    if (showRoute && showRoute.coordinates && showRoute.coordinates.length > 0) {
      routeManagerRef.current.drawRoute(showRoute.coordinates);
    } else {
      routeManagerRef.current.clear();
    }
  }, [showRoute, isLoaded]);

  // Draw Geofences (Circles / Polygons)
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Clear previous geofence overlays
    geofenceOverlaysRef.current.forEach((o) => o.setMap(null));
    geofenceOverlaysRef.current = [];

    geofences.forEach((geo) => {
      if (!geo.is_active) return;

      if (geo.geofence_type === 'circle' && geo.center_lat && geo.center_lng && geo.radius_meters) {
        const circle = new google.maps.Circle({
          strokeColor: '#3b82f6',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          map,
          center: { lat: geo.center_lat, lng: geo.center_lng },
          radius: geo.radius_meters,
        });
        geofenceOverlaysRef.current.push(circle);
      } else if (geo.geofence_type === 'polygon' && geo.polygon_coords && geo.polygon_coords.length > 2) {
        const polygon = new google.maps.Polygon({
          paths: geo.polygon_coords,
          strokeColor: '#8b5cf6',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#8b5cf6',
          fillOpacity: 0.15,
          map,
        });
        geofenceOverlaysRef.current.push(polygon);
      }
    });
  }, [geofences, isLoaded]);

  // Fit bounds to all vehicles
  const handleFitAll = useCallback(() => {
    if (!mapInstanceRef.current || vehicles.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    let hasCoords = false;

    vehicles.forEach((v) => {
      const loc = locations[v.id] || v.latest_location;
      if (loc && loc.latitude && loc.longitude) {
        bounds.extend({ lat: loc.latitude, lng: loc.longitude });
        hasCoords = true;
      }
    });

    if (hasCoords) {
      mapInstanceRef.current.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
  }, [vehicles, locations]);

  // Fallback UI when Google Maps API key is not configured
  if (!hasApiKey || loadError) {
    return (
      <div
        className={`relative w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex flex-col ${className}`}
        style={{ height }}
      >
        {/* Banner */}
        <div className="absolute top-4 left-4 right-4 z-20 bg-slate-900/90 backdrop-blur-md border border-amber-500/40 rounded-lg p-3 flex items-center justify-between text-xs text-amber-200 shadow-xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              Google Maps API key not configured. Please set{' '}
              <code className="text-amber-300 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                VITE_GOOGLE_MAPS_BROWSER_KEY
              </code>{' '}
              in your .env file. Showing interactive vector simulation map below.
            </span>
          </div>
          <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
            Interactive Fallback
          </span>
        </div>

        {/* Fallback Vector Grid Map */}
        <div className="relative w-full flex-1 flex items-center justify-center bg-[#0d1527] overflow-hidden select-none">
          {/* Subtle Grid Pattern */}
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #38bdf8 1px, transparent 0)`,
              backgroundSize: '36px 36px',
            }}
          />

          {/* Fallback Concentric Radar Rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[500px] h-[500px] rounded-full border border-blue-500/10" />
            <div className="w-[340px] h-[340px] rounded-full border border-blue-500/15" />
            <div className="w-[180px] h-[180px] rounded-full border border-blue-500/20" />
          </div>

          {/* Construction Site Construction Zones / Geofences */}
          <div className="absolute w-[420px] h-[260px] rounded-2xl border-2 border-dashed border-blue-500/30 bg-blue-500/5 pointer-events-none flex items-center justify-center">
            <span className="text-[11px] font-semibold text-blue-400 tracking-wider uppercase opacity-60">
              Active Construction Zone #1
            </span>
          </div>

          {/* Interactive Vehicle Icons placed across coordinates */}
          <div className="relative w-full h-full max-w-4xl max-h-[600px] p-8">
            {vehicles.map((v, idx) => {
              const loc = locations[v.id] || v.latest_location;
              const isSelected = selectedVehicleIds.includes(v.id);
              const color = getStatusColor(v.status);

              // Position deterministically or from lat/lng
              let xPercent = 20 + ((idx * 23) % 65);
              let yPercent = 25 + ((idx * 37) % 55);

              if (loc?.latitude && loc?.longitude) {
                // Normalize roughly around SF center 37.77, -122.41
                xPercent = Math.min(Math.max(((loc.longitude + 122.45) / 0.1) * 100, 10), 90);
                yPercent = Math.min(Math.max(((37.8 - loc.latitude) / 0.08) * 100, 10), 90);
              }

              return (
                <div
                  key={v.id}
                  onClick={() => {
                    setSelectedMockVehicle(v);
                    onVehicleSelect?.(v.id);
                  }}
                  style={{
                    left: `${xPercent}%`,
                    top: `${yPercent}%`,
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 group z-10 ${
                    isSelected ? 'scale-125 z-30' : 'hover:scale-110'
                  }`}
                >
                  <div className="relative flex flex-col items-center">
                    {/* Direction arrow badge */}
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-transform ${
                        isSelected ? 'ring-4 ring-white shadow-blue-500/50' : 'ring-2 ring-slate-900'
                      }`}
                      style={{ backgroundColor: color.hex }}
                    >
                      <MapPin className="w-5 h-5 text-white" />
                    </div>

                    {/* Label */}
                    <div className="mt-1 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-mono text-white whitespace-nowrap shadow">
                      {v.registration_number}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Details Modal on Mock Vehicle Click */}
          {selectedMockVehicle && (
            <div className="absolute bottom-4 left-4 z-30 bg-slate-900/95 border border-slate-700 rounded-xl p-4 shadow-2xl max-w-xs animate-in fade-in duration-200">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-white text-sm">{selectedMockVehicle.registration_number}</span>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                  style={{
                    backgroundColor: `${getStatusColor(selectedMockVehicle.status).hex}22`,
                    color: getStatusColor(selectedMockVehicle.status).hex,
                  }}
                >
                  {selectedMockVehicle.status}
                </span>
              </div>
              <div className="text-xs text-slate-300 space-y-1">
                <div>Type: {formatVehicleType(selectedMockVehicle.vehicle_type)}</div>
                <div>Speed: {formatSpeed(locations[selectedMockVehicle.id]?.speed)}</div>
                <div>Last Seen: {formatRelativeTime(locations[selectedMockVehicle.id]?.recorded_at)}</div>
              </div>
              <button
                onClick={() => setSelectedMockVehicle(null)}
                className="mt-3 w-full py-1 text-xs text-slate-400 hover:text-white bg-slate-800 rounded border border-slate-700"
              >
                Close Preview
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full rounded-xl overflow-hidden ${className}`} style={{ height }}>
      {/* Map Target Div */}
      <div ref={mapContainerRef} className="w-full h-full min-h-[300px] bg-slate-950" />

      {/* Map Control Buttons floating on top right */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleFitAll}
          leftIcon={<Maximize2 className="w-3.5 h-3.5" />}
          className="bg-slate-900/80 backdrop-blur-md border-slate-700 shadow-lg text-xs"
        >
          Fit All
        </Button>
      </div>
    </div>
  );
}

export default FleetMap;
