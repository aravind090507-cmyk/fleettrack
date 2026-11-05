import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LatestLocation, LocationPing } from '../../types';

function createPulseVehicleIcon(heading: number = 0) {
  const html = `
    <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      <div class="animate-ping-slow" style="position: absolute; width: 40px; height: 40px; border-radius: 50%; background-color: rgba(16, 185, 129, 0.4);"></div>
      <div style="position: relative; z-index: 2; transform: rotate(${heading}deg); transition: transform 0.3s ease;">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="#10b981" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'public-pulse-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

const originIcon = L.divIcon({
  html: `
    <div style="width: 28px; height: 28px; background: #3b82f6; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.5);">
      <div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  className: 'origin-marker',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const destinationIcon = L.divIcon({
  html: `
    <div style="width: 28px; height: 28px; background: #ef4444; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.5);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="3 2 19 9 3 16 3 2"/></svg>
    </div>
  `,
  className: 'destination-marker',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function MapPanFollower({
  center,
}: {
  center: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    map.panTo(center, { animate: true, duration: 1.0 });
  }, [center, map]);
  return null;
}

interface TrackingMapProps {
  currentLocation: LatestLocation | LocationPing | null;
  origin: { lat: number; lng: number; name: string };
  destination: { lat: number; lng: number; name: string };
  routeHistory?: [number, number][];
}

export const TrackingMap: React.FC<TrackingMapProps> = ({
  currentLocation,
  origin,
  destination,
  routeHistory = [],
}) => {
  const currentPos: [number, number] = currentLocation
    ? [currentLocation.latitude, currentLocation.longitude]
    : [origin.lat, origin.lng];

  const vehicleIcon = createPulseVehicleIcon(currentLocation?.heading || 0);

  // Combine route coordinates: Origin -> Route History -> Current Position
  const polylineCoords: [number, number][] = [
    [origin.lat, origin.lng],
    ...routeHistory,
    currentPos,
  ];

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <MapContainer
        center={currentPos}
        zoom={14}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="dark-tiles"
        />

        <MapPanFollower center={currentPos} />

        {/* Origin Marker */}
        <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
          <Popup>
            <div className="p-1 text-slate-900 font-semibold text-xs">
              <strong>Origin:</strong> {origin.name}
            </div>
          </Popup>
        </Marker>

        {/* Destination Marker */}
        <Marker position={[destination.lat, destination.lng]} icon={destinationIcon}>
          <Popup>
            <div className="p-1 text-slate-900 font-semibold text-xs">
              <strong>Destination:</strong> {destination.name}
            </div>
          </Popup>
        </Marker>

        {/* Dynamic Trajectory Polyline */}
        <Polyline
          positions={polylineCoords}
          pathOptions={{
            color: '#10b981',
            weight: 5,
            opacity: 0.85,
            lineJoin: 'round',
          }}
        />

        {/* Current Vehicle Marker */}
        <Marker position={currentPos} icon={vehicleIcon}>
          <Popup>
            <div className="p-1 text-slate-900 text-xs">
              <strong className="text-emerald-700 font-bold block mb-1">Live Vehicle Position</strong>
              <p>Speed: {currentLocation?.speed || 0} km/h</p>
              <p>Heading: {currentLocation?.heading || 0}°</p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};
