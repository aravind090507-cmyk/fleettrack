import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LatestLocation, LocationPing } from '../../types';
import { getMapTileConfig } from '../../services/mapConfig';

function isFiniteCoord(v: any): boolean {
  return typeof v === 'number' && !isNaN(v) && isFinite(v);
}

function isValidLatLng(lat: any, lng: any): boolean {
  return (
    isFiniteCoord(lat) &&
    isFiniteCoord(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function createPulseVehicleIcon(heading: number = 0) {
  const safeHeading = isFiniteCoord(heading) ? heading : 0;
  const html = `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div class="apple-radar-wave" style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(0, 113, 227, 0.35);"></div>
      <div style="position: relative; z-index: 2; transform: rotate(${safeHeading}deg); transition: transform 0.3s ease; width: 34px; height: 34px; border-radius: 50%; background: #0071e3; border: 3px solid #ffffff; box-shadow: 0 8px 20px rgba(0, 113, 227, 0.45); display: flex; align-items: center; justify-content: center;">
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

function MapPanFollower({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (map && center && isValidLatLng(center[0], center[1])) {
      try {
        map.panTo(center, { animate: true, duration: 1.0 });
      } catch (err) {
        console.warn('Leaflet panTo error:', err);
      }
    }
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
  // Defensive lat/lng extraction
  const safeOriginLat = isValidLatLng(origin?.lat, origin?.lng) ? Number(origin.lat) : 13.020767;
  const safeOriginLng = isValidLatLng(origin?.lat, origin?.lng) ? Number(origin.lng) : 80.178377;
  const safeDestLat = isValidLatLng(destination?.lat, destination?.lng) ? Number(destination.lat) : safeOriginLat;
  const safeDestLng = isValidLatLng(destination?.lat, destination?.lng) ? Number(destination.lng) : safeOriginLng;

  const currentLat = currentLocation?.latitude;
  const currentLng = currentLocation?.longitude;
  const hasValidCurrent = isValidLatLng(currentLat, currentLng);
  const currentPos: [number, number] = hasValidCurrent
    ? [Number(currentLat), Number(currentLng)]
    : [safeOriginLat, safeOriginLng];

  const vehicleIcon = createPulseVehicleIcon(currentLocation?.heading || 0);

  // Combine route coordinates: Origin -> Route History -> Current Position (strictly filter out non-numbers/NaNs)
  const validHistory = Array.isArray(routeHistory)
    ? routeHistory.filter(
        (pt): pt is [number, number] =>
          Array.isArray(pt) && pt.length >= 2 && isValidLatLng(pt[0], pt[1])
      )
    : [];

  const polylineCoords: [number, number][] = [
    [safeOriginLat, safeOriginLng],
    ...validHistory,
    currentPos,
  ];

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <MapContainer
        key={`${safeOriginLat.toFixed(4)}_${safeOriginLng.toFixed(4)}`}
        center={currentPos}
        zoom={14}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution={getMapTileConfig('apple').attribution}
          url={getMapTileConfig('apple').url}
          maxZoom={getMapTileConfig('apple').maxZoom}
          tileSize={getMapTileConfig('apple').tileSize}
          className={getMapTileConfig('apple').className}
        />

        <MapPanFollower center={currentPos} />

        {/* Origin Marker */}
        {isValidLatLng(safeOriginLat, safeOriginLng) && (
          <Marker position={[safeOriginLat, safeOriginLng]} icon={originIcon}>
            <Popup>
              <div className="p-1 text-slate-900 font-semibold text-xs">
                <strong>Origin:</strong> {origin?.name || 'Start Point'}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Destination Marker */}
        {isValidLatLng(safeDestLat, safeDestLng) && (
          <Marker position={[safeDestLat, safeDestLng]} icon={destinationIcon}>
            <Popup>
              <div className="p-1 text-slate-900 font-semibold text-xs">
                <strong>Destination:</strong> {destination?.name || 'Destination'}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Apple Maps Style Route Polyline */}
        {polylineCoords.length >= 2 && (
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
        )}

        {/* Current Vehicle Marker */}
        {isValidLatLng(currentPos[0], currentPos[1]) && (
          <Marker position={currentPos} icon={vehicleIcon}>
            <Popup>
              <div className="p-1 text-slate-900 text-xs">
                <strong className="text-emerald-700 font-bold block mb-1">Live Vehicle Position</strong>
                <p>Speed: {currentLocation?.speed || 0} km/h</p>
                <p>Heading: {currentLocation?.heading || 0}°</p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};
