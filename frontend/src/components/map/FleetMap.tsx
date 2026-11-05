import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ActiveVehicleTelemetry } from '../../types';

export interface SelectedTransitInfo {
  journey_id?: string;
  id?: string;
  vehicle_id?: string;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  vehicle_registration?: string;
  driver_name?: string;
  status?: string;
  total_distance_km?: number;
  latest_event_type?: string | null;
  latest_speed?: number | null;
}

// Helper component to auto-pan or fit bounds
function MapController({
  vehicles,
  selectedId,
  selectedTransit,
  journeyPath,
}: {
  vehicles: ActiveVehicleTelemetry[];
  selectedId: string | null;
  selectedTransit?: SelectedTransitInfo | null;
  journeyPath?: [number, number][];
}) {
  const map = useMap();

  useEffect(() => {
    // 1. If a transit is selected, fit bounds to the entire journey (origin, destination, path)
    if (selectedTransit) {
      const points: [number, number][] = [];
      if (selectedTransit.origin_lat != null && selectedTransit.origin_lng != null) {
        points.push([selectedTransit.origin_lat, selectedTransit.origin_lng]);
      }
      if (selectedTransit.destination_lat != null && selectedTransit.destination_lng != null) {
        points.push([selectedTransit.destination_lat, selectedTransit.destination_lng]);
      }
      if (journeyPath && journeyPath.length > 0) {
        for (const pt of journeyPath) {
          if (pt && pt[0] != null && pt[1] != null && !isNaN(pt[0]) && !isNaN(pt[1])) {
            points.push(pt);
          }
        }
      }

      if (points.length > 0) {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
        return;
      }
    }

    // 2. If a vehicle is selected, pan smoothly to it
    if (selectedId) {
      const selected = vehicles.find((v) => v.vehicle_id === selectedId);
      if (selected && selected.latest_latitude && selected.latest_longitude) {
        map.flyTo([selected.latest_latitude, selected.latest_longitude], 16, { duration: 1.0 });
        return;
      }
    }

    // 3. Otherwise fit bounds to all visible vehicles
    const validCoords = vehicles
      .filter((v) => v.latest_latitude && v.latest_longitude)
      .map((v) => [v.latest_latitude!, v.latest_longitude!] as [number, number]);

    if (validCoords.length > 0) {
      const bounds = L.latLngBounds(validCoords);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [map, selectedId, selectedTransit, journeyPath, vehicles]);

  return null;
}

// Function to generate rotated SVG marker for vehicles
function createVehicleIcon(status: string, heading: number = 0, isSelected: boolean = false) {
  let bgColor = '#10b981'; // green for in transit
  if (status === 'OFFLINE') bgColor = '#f43f5e';
  else if (status === 'MAINTENANCE') bgColor = '#f59e0b';
  else if (status === 'AVAILABLE') bgColor = '#3b82f6';

  const strokeColor = isSelected ? '#ffffff' : '#0f172a';
  const scale = isSelected ? 1.3 : 1.0;

  const pulseRing = isSelected || status === 'IN_TRANSIT'
    ? `<div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(16, 185, 129, 0.35); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`
    : '';

  const html = `
    <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      ${pulseRing}
      <div style="transform: rotate(${heading}deg) scale(${scale}); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; transition: transform 0.3s ease; position: relative; z-index: 2;">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="${bgColor}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-vehicle-div-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
  });
}

// Pin for Transit Origin
const originIcon = L.divIcon({
  html: `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
      <div style="background: #10b981; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 1.5px solid white; white-space: nowrap; margin-bottom: 2px;">
        START
      </div>
      <div style="width: 24px; height: 24px; background: #10b981; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
        <div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>
      </div>
    </div>
  `,
  className: 'transit-origin-pin',
  iconSize: [50, 48],
  iconAnchor: [25, 48],
  popupAnchor: [0, -48],
});

// Pin for Transit Destination
const destinationIcon = L.divIcon({
  html: `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
      <div style="background: #ef4444; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 1.5px solid white; white-space: nowrap; margin-bottom: 2px;">
        GOAL
      </div>
      <div style="width: 24px; height: 24px; background: #ef4444; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="3 2 19 9 3 16 3 2"/></svg>
      </div>
    </div>
  `,
  className: 'transit-destination-pin',
  iconSize: [50, 48],
  iconAnchor: [25, 48],
  popupAnchor: [0, -48],
});

interface FleetMapProps {
  vehicles: ActiveVehicleTelemetry[];
  selectedVehicleId: string | null;
  onSelectVehicle?: (id: string) => void;
  selectedTransit?: SelectedTransitInfo | null;
  journeyPath?: [number, number][];
}

export const FleetMap: React.FC<FleetMapProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  selectedTransit,
  journeyPath = [],
}) => {
  // Default to Bangalore / India if no coordinates
  const defaultCenter: [number, number] = [12.9716, 77.5946];

  const vehiclesWithCoords = useMemo(
    () => vehicles.filter((v) => v.latest_latitude != null && v.latest_longitude != null),
    [vehicles]
  );

  // Full polyline coordinates: origin -> journey path breadcrumbs -> destination/latest
  const fullPolyline: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [];
    if (
      selectedTransit &&
      selectedTransit.origin_lat != null &&
      selectedTransit.origin_lng != null &&
      !isNaN(selectedTransit.origin_lat) &&
      !isNaN(selectedTransit.origin_lng)
    ) {
      pts.push([selectedTransit.origin_lat, selectedTransit.origin_lng]);
    }
    if (journeyPath && journeyPath.length > 0) {
      for (const pt of journeyPath) {
        if (pt && pt[0] != null && pt[1] != null && !isNaN(pt[0]) && !isNaN(pt[1])) {
          pts.push(pt);
        }
      }
    }
    return pts;
  }, [selectedTransit, journeyPath]);

  return (
    <div className="relative w-full h-full min-h-[450px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="dark-tiles"
        />

        <MapController
          vehicles={vehiclesWithCoords}
          selectedId={selectedVehicleId}
          selectedTransit={selectedTransit}
          journeyPath={journeyPath}
        />

        {/* Selected Transit Path (Traveled Breadcrumb Polyline) */}
        {fullPolyline.length > 1 && (
          <>
            {/* Soft glowing outer halo */}
            <Polyline
              positions={fullPolyline}
              pathOptions={{
                color: '#059669',
                weight: 7,
                opacity: 0.4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {/* Crisp vibrant inner route */}
            <Polyline
              positions={fullPolyline}
              pathOptions={{
                color: '#10b981',
                weight: 3.5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        )}

        {/* Selected Transit Origin Pin */}
        {selectedTransit &&
          selectedTransit.origin_lat != null &&
          selectedTransit.origin_lng != null && (
            <Marker
              position={[selectedTransit.origin_lat, selectedTransit.origin_lng]}
              icon={originIcon}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[160px] text-slate-900">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase block tracking-wider">
                    Origin Start Point
                  </span>
                  <p className="font-bold text-sm text-slate-900">{selectedTransit.origin_name || 'Origin'}</p>
                  <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                    {selectedTransit.origin_lat.toFixed(5)}, {selectedTransit.origin_lng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}

        {/* Selected Transit Destination Pin */}
        {selectedTransit &&
          selectedTransit.destination_lat != null &&
          selectedTransit.destination_lng != null && (
            <Marker
              position={[selectedTransit.destination_lat, selectedTransit.destination_lng]}
              icon={destinationIcon}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[160px] text-slate-900">
                  <span className="text-[10px] font-bold text-rose-700 uppercase block tracking-wider">
                    Target Destination
                  </span>
                  <p className="font-bold text-sm text-slate-900">{selectedTransit.destination_name || 'Destination'}</p>
                  <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                    {selectedTransit.destination_lat.toFixed(5)}, {selectedTransit.destination_lng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}

        {/* If transit is completed and vehicle is not active, render vehicle marker at last recorded ping */}
        {selectedTransit &&
          !vehiclesWithCoords.some((v) => v.vehicle_id === selectedTransit.vehicle_id) &&
          (journeyPath.length > 0 || (selectedTransit.origin_lat != null && selectedTransit.origin_lng != null)) && (() => {
            const lastPos = journeyPath.length > 0
              ? journeyPath[journeyPath.length - 1]
              : [selectedTransit.origin_lat!, selectedTransit.origin_lng!] as [number, number];
            const icon = createVehicleIcon(selectedTransit.status || 'COMPLETED', 0, true);
            return (
              <Marker position={lastPos} icon={icon}>
                <Popup className="custom-leaflet-popup">
                  <div className="p-1 min-w-[180px] text-slate-900">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 uppercase block mb-1">
                      {selectedTransit.status || 'COMPLETED'}
                    </span>
                    <h5 className="font-bold text-sm">{selectedTransit.vehicle_registration || 'Vehicle'}</h5>
                    <p className="text-xs text-slate-600">Driver: {selectedTransit.driver_name || 'Driver'}</p>
                    <p className="text-xs text-emerald-700 font-bold mt-1">
                      Distance: {selectedTransit.total_distance_km || 0} km
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })()}

        {/* Fleet Vehicle Markers */}
        {vehiclesWithCoords.map((v) => {
          const lat = v.latest_latitude!;
          const lng = v.latest_longitude!;
          const isSelected = Boolean(
            v.vehicle_id === selectedVehicleId ||
            (selectedTransit && (selectedTransit as any).vehicle_id === v.vehicle_id)
          );
          const icon = createVehicleIcon(v.status, v.latest_heading || 0, isSelected);

          return (
            <Marker
              key={v.vehicle_id}
              position={[lat, lng]}
              icon={icon}
              eventHandlers={{
                click: () => onSelectVehicle && onSelectVehicle(v.vehicle_id),
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[190px] text-slate-900">
                  <div className="flex items-center justify-between border-b pb-1 mb-1.5">
                    <span className="font-bold text-sm tracking-wide">{v.registration_number}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 uppercase">
                      {v.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mb-1">{v.model}</p>
                  <p className="text-xs text-slate-700">
                    <strong>Driver:</strong> {v.assigned_driver_name || 'Unassigned'}
                  </p>
                  <p className="text-xs text-slate-700">
                    <strong>Speed:</strong> {v.latest_speed || 0} km/h
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Updated: {v.latest_recorded_at ? new Date(v.latest_recorded_at).toLocaleTimeString() : 'N/A'}
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
