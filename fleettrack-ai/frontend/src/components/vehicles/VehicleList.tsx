import React, { useState, useMemo } from 'react';
import { Vehicle, VehicleLocation } from '../../types';
import { VehicleStatusBadge } from './VehicleStatusBadge';
import { formatVehicleType, formatSpeed, formatRelativeTime } from '../../utils/formatters';
import { Search, Filter, Truck, CheckSquare, Square, Eye, Route, Edit2, Trash2 } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';

interface VehicleListProps {
  vehicles: Vehicle[];
  locations?: Record<string, VehicleLocation>;
  selectedVehicleIds?: string[];
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onEditVehicle?: (vehicle: Vehicle) => void;
  onDeleteVehicle?: (vehicle: Vehicle) => void;
  isAdmin?: boolean;
}

export function VehicleList({
  vehicles = [],
  locations = {},
  selectedVehicleIds = [],
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onEditVehicle,
  onDeleteVehicle,
  isAdmin = false,
}: VehicleListProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      const matchesSearch =
        v.registration_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.device_id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === 'all' || v.vehicle_type === typeFilter;
      const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [vehicles, searchTerm, typeFilter, statusFilter]);

  const allSelected =
    filteredVehicles.length > 0 &&
    filteredVehicles.every((v) => selectedVehicleIds.includes(v.id));

  return (
    <div className="flex flex-col h-full bg-slate-800 rounded-xl border border-slate-700/80 overflow-hidden">
      {/* Top Controls */}
      <div className="p-4 border-b border-slate-700/80 bg-slate-800/80 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search registration or device ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-36 text-xs"
            >
              <option value="all">All Types</option>
              <option value="dump_truck">Dump Truck</option>
              <option value="excavator">Excavator</option>
              <option value="concrete_mixer">Concrete Mixer</option>
              <option value="loader">Wheel Loader</option>
              <option value="crane_truck">Crane Truck</option>
            </Select>

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-32 text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="moving">Moving</option>
              <option value="idle">Idle</option>
              <option value="active">Active</option>
              <option value="offline">Offline</option>
              <option value="maintenance">Maintenance</option>
            </Select>
          </div>
        </div>

        {/* Selection bar */}
        {onToggleSelect && (
          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
            <button
              onClick={() => {
                if (allSelected) {
                  onClearSelection?.();
                } else {
                  onSelectAll?.();
                }
              }}
              className="flex items-center gap-2 hover:text-white transition-colors"
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-blue-400" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>
                Select All ({selectedVehicleIds.length} of {filteredVehicles.length} selected)
              </span>
            </button>
            {selectedVehicleIds.length > 0 && onClearSelection && (
              <button
                onClick={onClearSelection}
                className="text-blue-400 hover:text-blue-300 font-medium"
              >
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table / List */}
      <div className="flex-1 overflow-x-auto">
        {filteredVehicles.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Truck className="w-10 h-10 mx-auto mb-2 text-slate-500 opacity-50" />
            <p className="text-sm font-medium">No vehicles found</p>
            <p className="text-xs text-slate-500 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700/80 bg-slate-850/60 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                {onToggleSelect && <th className="p-3 w-10"></th>}
                <th className="p-3">Vehicle</th>
                <th className="p-3">Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Speed</th>
                <th className="p-3">Project</th>
                <th className="p-3">Last Seen</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40 text-sm">
              {filteredVehicles.map((vehicle) => {
                const loc = locations[vehicle.id] || vehicle.latest_location;
                const isSelected = selectedVehicleIds.includes(vehicle.id);

                return (
                  <tr
                    key={vehicle.id}
                    className={`hover:bg-slate-750/70 transition-colors ${
                      isSelected ? 'bg-blue-900/10' : ''
                    }`}
                  >
                    {onToggleSelect && (
                      <td className="p-3">
                        <button
                          onClick={() => onToggleSelect(vehicle.id)}
                          className="text-slate-400 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    )}
                    <td className="p-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <div>
                          <div>{vehicle.registration_number}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            ID: {vehicle.device_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-slate-300">
                      {formatVehicleType(vehicle.vehicle_type)}
                    </td>
                    <td className="p-3">
                      <VehicleStatusBadge status={vehicle.status} size="sm" />
                    </td>
                    <td className="p-3 text-slate-300 font-mono">
                      {formatSpeed(loc?.speed)}
                    </td>
                    <td className="p-3 text-slate-300">
                      {vehicle.project ? (
                        <span className="text-slate-200">{vehicle.project.name}</span>
                      ) : (
                        <span className="text-slate-500 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-slate-400">
                      {formatRelativeTime(loc?.recorded_at)}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/live-tracking?vehicleId=${vehicle.id}`)}
                          title="Track Vehicle"
                          className="p-1.5 h-8 text-blue-400 hover:text-blue-300"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/route-history?vehicleId=${vehicle.id}`)}
                          title="Route History"
                          className="p-1.5 h-8 text-emerald-400 hover:text-emerald-300"
                        >
                          <Route className="w-4 h-4" />
                        </Button>
                        {isAdmin && onEditVehicle && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditVehicle(vehicle)}
                            title="Edit Vehicle"
                            className="p-1.5 h-8 text-amber-400 hover:text-amber-300"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                        {isAdmin && onDeleteVehicle && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteVehicle(vehicle)}
                            title="Delete Vehicle"
                            className="p-1.5 h-8 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default VehicleList;
