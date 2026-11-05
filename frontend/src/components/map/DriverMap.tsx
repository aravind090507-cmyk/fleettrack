import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LocationPing } from '../../types';

function createDriverVehicleIcon(heading: number = 0) {
  const html = `
    <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; transform: rotate(${heading}deg); transition: transform 0.3s ease;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#10b981" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">
        <polygon points="12 2 19 21 12 17 5 21 12 2"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'driver-gps-icon',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function DriverMapController({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

interface DriverMapProps {
  position: LocationPing | null;
  destination?: { lat: number; lng: number; name: string };
}

export const DriverMap: React.FC<DriverMapProps> = ({ position, destination }) => {
  const center: [number, number] = position
    ? [position.latitude, position.longitude]
    : [12.9716, 77.5946];

  const icon = createDriverVehicleIcon(position?.heading || 0);

  return (
    <div className="relative w-full h-full min-h-[220px] rounded-2xl overflow-hidden border border-slate-800">
      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom={false}
        zoomControl={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="dark-tiles"
        />

        <DriverMapController center={center} />

        {position && (
          <Marker position={[position.latitude, position.longitude]} icon={icon}>
            <Popup>
              <div className="p-1 text-slate-900 text-xs font-semibold">
                Your Current GPS Position
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};
