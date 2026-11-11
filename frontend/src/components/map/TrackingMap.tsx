import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LatestLocation, LocationPing } from '../../types';

function createPulseVehicleIcon(heading: number = 0) {
  const html = `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div class="apple-radar-wave" style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(0, 113, 227, 0.35);"></div>
      <div style="position: relative; z-index: 2; transform: rotate(${heading}deg); transition: transform 0.3s ease; width: 34px; height: 34px; border-radius: 50%; background: #0071e3; border: 3px solid #ffffff; box-shadow: 0 8px 20px rgba(0, 113, 227, 0.45); display: flex; align-items: center; justify-content: center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" stroke="none">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'apple-vehicle-pulse-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

const originIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #1c1c1e; border: 2.5px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.35);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
    </div>
  `,
  className: 'apple-origin-marker',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const destinationIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #ff3b30; border: 2.5px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(255,59,48,0.4);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
    </div>
  `,
  className: 'apple-dest-marker',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
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
  const safeOriginLat = origin?.lat ?? 12.9716;
  const safeOriginLng = origin?.lng ?? 77.5946;
  const safeDestLat = destination?.lat ?? safeOriginLat;
  const safeDestLng = destination?.lng ?? safeOriginLng;

  const currentPos: [number, number] =
    currentLocation && !isNaN(currentLocation.latitude) && !isNaN(currentLocation.longitude)
      ? [currentLocation.latitude, currentLocation.longitude]
      : [safeOriginLat, safeOriginLng];

  const vehicleIcon = createPulseVehicleIcon(currentLocation?.heading || 0);

  // Combine route coordinates: Origin -> Route History -> Current Position
  const polylineCoords: [number, number][] = [
    [safeOriginLat, safeOriginLng],
    ...routeHistory.filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng)),
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          className="map-tiles-apple"
        />

        <MapPanFollower center={currentPos} />

        {/* Origin Marker */}
        <Marker position={[safeOriginLat, safeOriginLng]} icon={originIcon}>
          <Popup>
            <div className="p-1 text-slate-900 font-semibold text-xs">
              <strong>Origin:</strong> {origin?.name || 'Start Point'}
            </div>
          </Popup>
        </Marker>

        {/* Destination Marker */}
        <Marker position={[safeDestLat, safeDestLng]} icon={destinationIcon}>
          <Popup>
            <div className="p-1 text-slate-900 font-semibold text-xs">
              <strong>Destination:</strong> {destination?.name || 'Destination'}
            </div>
          </Popup>
        </Marker>

        {/* Apple Maps Style Route Polyline */}
        <Polyline
          positions={polylineCoords}
          pathOptions={{
            color: '#0071e3',
            weight: 6,
            opacity: 0.9,
            lineCap: 'round',
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
