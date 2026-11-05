import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Compass, Gauge, Clock, History, Building2, MapPin } from 'lucide-react';
import { Vehicle, VehicleLocation, Project } from '../../types';
import { formatSpeed, formatVehicleType, getStatusColor, formatRelativeTime } from '../../utils/formatters';
import { ETADisplay } from './ETADisplay';

interface TrackingPanelProps {
  vehicle: Vehicle;
  location?: VehicleLocation | null;
  projects?: Project[];
  onClose?: () => void;
}

export function TrackingPanel({ vehicle, location, projects = [], onClose }: TrackingPanelProps) {
  const navigate = useNavigate();
  const loc = location || vehicle.latest_location;
  const statusColor = getStatusColor(vehicle.status);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-white font-mono tracking-tight">
              {vehicle.registration_number}
            </span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: `${statusColor.hex}22`, color: statusColor.hex }}
            >
              {vehicle.status}
            </span>
          </div>
          <div className="text-xs text-slate-400 capitalize mt-0.5">
            {formatVehicleType(vehicle.vehicle_type)}
          </div>
        </div>

        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">
            ✕
          </button>
        )}
      </div>

      {/* Telemetry Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Speed */}
        <div className="p-2.5 bg-slate-800/60 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1">
            <Gauge className="w-3.5 h-3.5 text-blue-400" />
            <span>Speed</span>
          </div>
          <div className="text-base font-bold text-white font-mono">
            {loc ? formatSpeed(loc.speed) : '--'}
          </div>
        </div>

        {/* Heading */}
        <div className="p-2.5 bg-slate-800/60 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1">
            <Compass className="w-3.5 h-3.5 text-emerald-400" />
            <span>Heading</span>
          </div>
          <div className="text-base font-bold text-white font-mono">
            {loc?.heading !== undefined ? `${Math.round(loc.heading)}°` : '--'}
          </div>
        </div>
      </div>

      {/* GPS Coordinates & Timestamp */}
      <div className="p-3 bg-slate-800/40 border border-slate-800 rounded-lg space-y-1.5 text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-slate-500" /> Coordinates
          </span>
          <span className="font-mono text-white text-[11px]">
            {loc ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}` : 'Waiting for GPS...'}
          </span>
        </div>

        <div className="flex items-center justify-between text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-500" /> Last Updated
          </span>
          <span className="text-slate-300 text-[11px]">
            {loc ? formatRelativeTime(loc.recorded_at) : '--'}
          </span>
        </div>
      </div>

      {/* Destination & ETA Calculation */}
      <ETADisplay vehicle={vehicle} projects={projects} />

      {/* Action to History */}
      <button
        onClick={() => navigate(`/history?vehicleId=${vehicle.id}`)}
        className="w-full py-2 bg-slate-800 hover:bg-slate-700/80 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
      >
        <History className="w-3.5 h-3.5 text-slate-400" />
        View Historical Route & Replay
      </button>
    </div>
  );
}
export default TrackingPanel;
