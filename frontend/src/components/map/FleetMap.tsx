import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
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

export interface ReplayPoint {
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  recorded_at?: string;
  accuracy?: number;
}

function getCardinalDirection(heading: number = 0): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((heading % 360) / 45)) % 8;
  return directions[index];
}

// Helper component to auto-pan or fit bounds
function MapController({
  vehicles,
  selectedId,
  selectedTransit,
  journeyPath,
  replayPoint,
  followSelected = false,
}: {
  vehicles: ActiveVehicleTelemetry[];
  selectedId: string | null;
  selectedTransit?: SelectedTransitInfo | null;
  journeyPath?: [number, number][];
  replayPoint?: ReplayPoint | null;
  followSelected?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    // 0. If route playback is running, follow replay vehicle smoothly
    if (replayPoint && replayPoint.latitude && replayPoint.longitude) {
      map.panTo([replayPoint.latitude, replayPoint.longitude], { animate: true, duration: 0.3 });
      return;
    }

    // 1. If followSelected is enabled and a vehicle is selected, pan to it smoothly
    if (followSelected && selectedId) {
      const selected = vehicles.find((v) => v.vehicle_id === selectedId);
      if (selected && selected.latest_latitude && selected.latest_longitude) {
        map.panTo([selected.latest_latitude, selected.latest_longitude], { animate: true, duration: 0.5 });
        return;
      }
    }

    // 2. If a transit is selected, fit bounds to the entire journey (origin, destination, path)
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

function createReplayIcon(heading: number = 0, speed: number = 0) {
  const html = `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 48px; height: 48px; border-radius: 50%; background-color: rgba(99, 102, 241, 0.4); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; top: -14px; background: #4f46e5; color: white; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 9999px; border: 1.5px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); white-space: nowrap; z-index: 10;">
        ${Math.round(speed)} km/h
      </div>
      <div style="transform: rotate(${heading}deg) scale(1.3); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; position: relative; z-index: 5;">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="#6366f1" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'replay-vehicle-div-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -22],
  });
}

// Function to generate rotated SVG marker for vehicles
function createVehicleIcon(
  status: string,
  heading: number = 0,
  speed: number = 0,
  isSelected: boolean = false,
  eventType?: string | null
) {
  const isMoving = speed > 2;
  const isOnline = status === 'IN_TRANSIT' || status === 'AVAILABLE' || status === 'online';
  const isOffline = status === 'OFFLINE' || status === 'offline';

  let bgColor = '#94a3b8'; // Unknown grey
  if (isOnline) {
    bgColor = isMoving ? '#10b981' : '#f59e0b'; // Online: moving emerald, stopped/idling amber
  } else if (isOffline) {
    bgColor = '#ef4444'; // Offline red
  }

  if (eventType === 'SOS') bgColor = '#ef4444';
  else if (eventType === 'BREAKDOWN') bgColor = '#f59e0b';
  else if (eventType === 'BREAK_START') bgColor = '#eab308';

  const isEmergency = eventType === 'SOS';
  const strokeColor = isSelected || isEmergency ? '#ffffff' : '#0f172a';
  const scale = isSelected || isEmergency ? 1.35 : 1.0;

  const pulseColor = isEmergency
    ? 'rgba(239, 68, 68, 0.6)'
    : isMoving
    ? 'rgba(16, 185, 129, 0.4)'
    : 'rgba(245, 158, 11, 0.3)';

  const pulseRing =
    isSelected || isMoving || isEmergency
      ? `<div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: ${pulseColor}; animation: ping ${
          isEmergency ? '1s' : isMoving ? '1.5s' : '2.5s'
        } cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`
      : '';

  const badgeHtml =
    eventType === 'SOS'
      ? `<div style="position: absolute; top: -10px; right: -10px; background: #ef4444; color: white; font-size: 9px; font-weight: 900; padding: 1px 5px; border-radius: 9999px; border: 1.5px solid white; z-index: 5; box-shadow: 0 2px 6px rgba(0,0,0,0.6); animation: bounce 1s infinite;">SOS</div>`
      : eventType === 'BREAKDOWN'
      ? `<div style="position: absolute; top: -10px; right: -10px; background: #f59e0b; color: white; font-size: 9px; font-weight: 900; padding: 1px 5px; border-radius: 9999px; border: 1.5px solid white; z-index: 5; box-shadow: 0 2px 6px rgba(0,0,0,0.6);">FIX</div>`
      : isMoving
      ? `<div style="position: absolute; top: -9px; background: #10b981; color: white; font-size: 8px; font-weight: 800; padding: 0.5px 5px; border-radius: 9999px; border: 1px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.4); white-space: nowrap; z-index: 6;">${Math.round(speed)}k</div>`
      : `<div style="position: absolute; top: -9px; background: #64748b; color: white; font-size: 8px; font-weight: 800; padding: 0.5px 4px; border-radius: 9999px; border: 1px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.4); white-space: nowrap; z-index: 6;">STOP</div>`;

  // Rotate by course ONLY when moving and course valid
  const rotation = isMoving && heading != null && heading >= 0 ? heading : 0;

  const innerSvg = isMoving
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="${bgColor}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.5));">
         <polygon points="12 2 19 21 12 17 5 21 12 2"/>
       </svg>`
    : `<svg width="26" height="26" viewBox="0 0 24 24" fill="${bgColor}" stroke="${strokeColor}" stroke-width="2.5" style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.5));">
         <circle cx="12" cy="12" r="8"/>
         <circle cx="12" cy="12" r="3" fill="#ffffff"/>
       </svg>`;

  const html = `
    <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      ${pulseRing}
      ${badgeHtml}
      <div style="transform: rotate(${rotation}deg) scale(${scale}); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; transition: transform 0.4s ease, scale 0.2s ease; position: relative; z-index: 2;">
        ${innerSvg}
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
  replayPoint?: ReplayPoint | null;
}

export const FleetMap: React.FC<FleetMapProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  selectedTransit,
  journeyPath = [],
  replayPoint,
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

  const [followSelected, setFollowSelected] = useState<boolean>(true);

  return (
    <div className="relative w-full h-full min-h-[450px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* Top Map Controls Overlay */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFollowSelected((f) => !f)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg transition backdrop-blur-md border ${
            followSelected
              ? 'bg-emerald-600/90 text-white border-emerald-500 shadow-emerald-950/50'
              : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'
          }`}
        >
          {followSelected ? '🎯 Following Vehicle' : '📍 Free Pan'}
        </button>
      </div>

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
          replayPoint={replayPoint}
          followSelected={followSelected}
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

        {/* Active Route Playback Marker (Traccar style animated replay) */}
        {replayPoint && (
          <Marker
            position={[replayPoint.latitude, replayPoint.longitude]}
            icon={createReplayIcon(replayPoint.heading || 0, replayPoint.speed || 0)}
          >
            <Popup className="custom-leaflet-popup" autoPan={false}>
              <div className="p-1 min-w-[200px] text-slate-900 font-sans">
                <div className="flex items-center justify-between border-b pb-1 mb-1.5">
                  <span className="font-black text-xs text-indigo-700 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                    Trip Replay Position
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-900 px-1.5 py-0.5 rounded">
                    {Math.round(replayPoint.speed || 0)} km/h
                  </span>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Course:</span>
                    <strong className="text-slate-800">{Math.round(replayPoint.heading || 0)}° ({getCardinalDirection(replayPoint.heading || 0)})</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Coordinates:</span>
                    <strong className="text-slate-800 font-mono text-[11px]">{replayPoint.latitude.toFixed(5)}, {replayPoint.longitude.toFixed(5)}</strong>
                  </div>
                  {replayPoint.recorded_at && (
                    <div className="flex justify-between text-slate-600 border-t pt-1 mt-1 text-[10px]">
                      <span>Timestamp:</span>
                      <strong className="text-slate-700">{new Date(replayPoint.recorded_at).toLocaleTimeString()}</strong>
                    </div>
                  )}
                </div>
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
            const icon = createVehicleIcon(
              selectedTransit.status || 'COMPLETED',
              0,
              0,
              true,
              selectedTransit.latest_event_type
            );
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
          const icon = createVehicleIcon(
            v.status,
            v.latest_heading || 0,
            v.latest_speed || 0,
            isSelected,
            v.latest_event_type
          );

          return (
            <React.Fragment key={v.vehicle_id}>
              {isSelected && (
                <Circle
                  center={[lat, lng]}
                  radius={40}
                  pathOptions={{
                    color: '#10b981',
                    fillColor: '#10b981',
                    fillOpacity: 0.18,
                    weight: 1.5,
                    dashArray: '4, 4',
                  }}
                />
              )}
              <Marker
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

                  {v.latest_event_type && (
                    <div
                      className={`mb-2 p-1.5 rounded-lg text-xs font-bold text-center border text-white ${
                        v.latest_event_type === 'SOS'
                          ? 'bg-rose-600 border-rose-700 animate-pulse'
                          : v.latest_event_type === 'BREAKDOWN'
                          ? 'bg-amber-600 border-amber-700'
                          : 'bg-yellow-500 text-slate-950 border-yellow-600'
                      }`}
                    >
                      {v.latest_event_type === 'SOS'
                        ? '🚨 EMERGENCY SOS ACTIVE'
                        : v.latest_event_type === 'BREAKDOWN'
                        ? '⚠️ BREAKDOWN REPORTED'
                        : '☕ ON REST BREAK'}
                    </div>
                  )}

                  <p className="text-xs text-slate-600 mb-1 font-medium">{v.model}</p>

                  {v.origin_name && v.destination_name && (
                    <div className="mb-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1">
                        <span>Current Dispatch Route:</span>
                      </div>
                      <div className="text-[11px] text-slate-800 flex items-center gap-1 truncate mb-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <strong className="text-slate-900 font-semibold shrink-0">From:</strong>
                        <span className="truncate">{v.origin_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-800 flex items-center gap-1 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                        <strong className="text-slate-900 font-semibold shrink-0">To:</strong>
                        <span className="truncate">{v.destination_name}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-200 mb-1">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Ignition:</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        (v.latest_speed && v.latest_speed > 2) || v.status === 'IN_TRANSIT'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}>
                        {(v.latest_speed && v.latest_speed > 2) || v.status === 'IN_TRANSIT' ? '⚡ ON' : 'OFF'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-slate-600">
                      <span>Speed:</span>
                      <strong className="text-slate-900 font-mono">{v.latest_speed || 0} km/h</strong>
                    </div>

                    <div className="flex justify-between items-center text-slate-600">
                      <span>Heading:</span>
                      <strong className="text-slate-900">{v.latest_heading || 0}° ({getCardinalDirection(v.latest_heading || 0)})</strong>
                    </div>

                    <div className="flex justify-between items-center text-slate-600">
                      <span>Coords:</span>
                      <strong className="text-slate-700 font-mono text-[10px]">{lat.toFixed(4)}, {lng.toFixed(4)}</strong>
                    </div>

                    <div className="flex justify-between items-center text-slate-600 border-t border-slate-200 pt-1 mt-1">
                      <span>Driver:</span>
                      <strong className="text-slate-800">{v.assigned_driver_name || 'Unassigned'}</strong>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 text-right">
                    Updated: {v.latest_recorded_at ? new Date(v.latest_recorded_at).toLocaleTimeString() : 'N/A'}
                  </p>

                  {v.current_journey_id && onSelectVehicle && (
                    <button
                      type="button"
                      onClick={() => onSelectVehicle(v.vehicle_id)}
                      className="mt-2 w-full py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                    >
                      <span>📍 View Live Trip Details</span>
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        );
      })}
      </MapContainer>
    </div>
  );
};
