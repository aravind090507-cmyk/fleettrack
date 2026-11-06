import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LocationPing } from '../../types';

function createDriverVehicleIcon(heading: number = 0) {
  const html = `
    <div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; transform: rotate(${heading}deg); transition: transform 0.3s ease;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="#10b981" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
        <polygon points="12 2 19 21 12 17 5 21 12 2"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'driver-gps-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

const driverOriginIcon = L.divIcon({
  html: `
    <div style="display: flex; flex-direction: column; align-items: center;">
      <div style="background: #10b981; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.5); border: 1.5px solid white; white-space: nowrap; margin-bottom: 2px;">
        START
      </div>
      <div style="width: 20px; height: 20px; background: #10b981; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
        <div style="width: 6px; height: 6px; background: white; border-radius: 50%;"></div>
      </div>
    </div>
  `,
  className: 'driver-origin-pin',
  iconSize: [48, 44],
  iconAnchor: [24, 44],
  popupAnchor: [0, -44],
});

const driverDestinationIcon = L.divIcon({
  html: `
    <div style="display: flex; flex-direction: column; align-items: center;">
      <div style="background: #ef4444; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.5); border: 1.5px solid white; white-space: nowrap; margin-bottom: 2px;">
        GOAL
      </div>
      <div style="width: 20px; height: 20px; background: #ef4444; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0,0,0,0.5);">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="3 2 19 9 3 16 3 2"/></svg>
      </div>
    </div>
  `,
  className: 'driver-destination-pin',
  iconSize: [48, 44],
  iconAnchor: [24, 44],
  popupAnchor: [0, -44],
});

function DriverMapController({
  position,
  origin,
  destination,
}: {
  position: LocationPing | null;
  origin?: { lat: number; lng: number; name: string };
  destination?: { lat: number; lng: number; name: string };
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];
    if (origin && origin.lat != null && origin.lng != null && !isNaN(origin.lat) && !isNaN(origin.lng)) {
      points.push([origin.lat, origin.lng]);
    }
    if (destination && destination.lat != null && destination.lng != null && !isNaN(destination.lat) && !isNaN(destination.lng)) {
      points.push([destination.lat, destination.lng]);
    }
    if (position && position.latitude != null && position.longitude != null) {
      points.push([position.latitude, position.longitude]);
    }

    if (points.length > 1) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], 15);
    }
  }, [position, origin, destination, map]);

  return null;
}

interface DriverMapProps {
  position: LocationPing | null;
  origin?: { lat: number; lng: number; name: string };
  destination?: { lat: number; lng: number; name: string };
}

export const DriverMap: React.FC<DriverMapProps> = ({ position, origin, destination }) => {
  const center: [number, number] = useMemo(() => {
    if (position && position.latitude != null && position.longitude != null) {
      return [position.latitude, position.longitude];
    }
    if (origin && origin.lat != null && origin.lng != null) {
      return [origin.lat, origin.lng];
    }
    if (destination && destination.lat != null && destination.lng != null) {
      return [destination.lat, destination.lng];
    }
    return [12.9716, 77.5946];
  }, [position, origin, destination]);

  const vehicleIcon = createDriverVehicleIcon(position?.heading || 0);

  // Construct route line connecting Origin -> Live Position -> Destination
  const routePoints: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [];
    if (origin && origin.lat != null && origin.lng != null && !isNaN(origin.lat) && !isNaN(origin.lng)) {
      pts.push([origin.lat, origin.lng]);
    }
    if (position && position.latitude != null && position.longitude != null) {
      pts.push([position.latitude, position.longitude]);
    }
    if (destination && destination.lat != null && destination.lng != null && !isNaN(destination.lat) && !isNaN(destination.lng)) {
      pts.push([destination.lat, destination.lng]);
    }
    return pts;
  }, [origin, position, destination]);

  return (
    <div className="relative w-full h-full min-h-[220px] rounded-2xl overflow-hidden border border-slate-800">
      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom={true}
        zoomControl={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="dark-tiles"
        />

        <DriverMapController position={position} origin={origin} destination={destination} />

        {/* Route Line */}
        {routePoints.length > 1 && (
          <>
            <Polyline
              positions={routePoints}
              pathOptions={{
                color: '#059669',
                weight: 6,
                opacity: 0.4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Polyline
              positions={routePoints}
              pathOptions={{
                color: '#10b981',
                weight: 3,
                opacity: 0.9,
                dashArray: '6, 6',
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        )}

        {/* Starting Location (Origin Marker) */}
        {origin && origin.lat != null && origin.lng != null && (
          <Marker position={[origin.lat, origin.lng]} icon={driverOriginIcon}>
            <Popup>
              <div className="p-1 min-w-[150px] text-slate-900">
                <span className="text-[10px] font-bold text-emerald-700 uppercase block tracking-wider">
                  Source / Starting Location
                </span>
                <p className="font-bold text-xs text-slate-900">{origin.name || 'Start Point'}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Ending Location (Destination Marker) */}
        {destination && destination.lat != null && destination.lng != null && (
          <Marker position={[destination.lat, destination.lng]} icon={driverDestinationIcon}>
            <Popup>
              <div className="p-1 min-w-[150px] text-slate-900">
                <span className="text-[10px] font-bold text-rose-700 uppercase block tracking-wider">
                  Target Destination
                </span>
                <p className="font-bold text-xs text-slate-900">{destination.name || 'Destination Point'}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Moving Live Vehicle Marker */}
        {position && (
          <Marker position={[position.latitude, position.longitude]} icon={vehicleIcon}>
            <Popup>
              <div className="p-1 min-w-[160px] text-slate-900">
                <span className="text-[10px] font-bold text-emerald-600 uppercase block tracking-wider">
                  Live GPS Position
                </span>
                <p className="font-bold text-xs text-slate-900 font-mono">
                  Speed: {position.speed != null ? `${Math.round(position.speed)} km/h` : '0 km/h'}
                </p>
                <p className="text-[10px] text-slate-600 font-mono">
                  {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};
