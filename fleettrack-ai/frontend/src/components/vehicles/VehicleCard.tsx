import React from 'react';
import { Vehicle, VehicleLocation } from '../../types';
import { VehicleStatusBadge } from './VehicleStatusBadge';
import { formatVehicleType, formatSpeed, formatRelativeTime } from '../../utils/formatters';
import { Truck, Navigation, Gauge, Clock, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';

interface VehicleCardProps {
  vehicle: Vehicle;
  location?: VehicleLocation | null;
  isSelected?: boolean;
  onSelect?: () => void;
  onTrack?: () => void;
  className?: string;
}

export function VehicleCard({
  vehicle,
  location,
  isSelected = false,
  onSelect,
  onTrack,
  className = '',
}: VehicleCardProps) {
  const navigate = useNavigate();
  const loc = location || vehicle.latest_location;

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? 'bg-slate-800 border-blue-500 shadow-lg ring-1 ring-blue-500'
          : 'bg-slate-850 hover:bg-slate-800 border-slate-700/80 hover:border-slate-600'
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-400">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-white text-sm">{vehicle.registration_number}</h4>
            <span className="text-xs text-slate-400">{formatVehicleType(vehicle.vehicle_type)}</span>
          </div>
        </div>
        <VehicleStatusBadge status={vehicle.status} size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-2 my-3 py-2.5 px-3 rounded-lg bg-slate-900/60 border border-slate-800/80 text-xs">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Gauge className="w-3.5 h-3.5 text-slate-400" />
          <span>{formatSpeed(loc?.speed)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span className="truncate">{formatRelativeTime(loc?.recorded_at)}</span>
        </div>
        {vehicle.project && (
          <div className="col-span-2 text-slate-400 truncate">
            <span className="text-slate-500">Project: </span>
            <span className="text-slate-300">{vehicle.project.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/route-history?vehicleId=${vehicle.id}`);
          }}
          className="text-xs flex-1 py-1 h-8"
        >
          History
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            if (onTrack) {
              onTrack();
            } else {
              navigate(`/live-tracking?vehicleId=${vehicle.id}`);
            }
          }}
          rightIcon={<ArrowRight className="w-3 h-3" />}
          className="text-xs flex-1 py-1 h-8"
        >
          Track
        </Button>
      </div>
    </div>
  );
}

export default VehicleCard;
