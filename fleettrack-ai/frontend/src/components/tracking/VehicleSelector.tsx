import React, { useState } from 'react';
import { Search, CheckSquare, Square, Truck, Navigation2 } from 'lucide-react';
import { Vehicle, VehicleLocation } from '../../types';
import { formatSpeed, formatVehicleType, getStatusColor } from '../../utils/formatters';

interface VehicleSelectorProps {
  vehicles: Vehicle[];
  locations: Record<string, VehicleLocation>;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function VehicleSelector({
  vehicles,
  locations,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
}: VehicleSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = vehicles.filter((v) => {
    const matchesSearch =
      v.registration_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.vehicle_type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || v.vehicle_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const allSelected = filtered.length > 0 && filtered.every((v) => selectedIds.includes(v.id));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-full overflow-hidden">
      {/* Header & Search */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Vehicles ({filtered.length})
          </span>
          <button
            onClick={allSelected ? onClearSelection : onSelectAll}
            className="text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
          >
            {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search registration or type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Vehicle List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">No vehicles matching filter</div>
        ) : (
          filtered.map((v) => {
            const loc = locations[v.id] || v.latest_location;
            const isSelected = selectedIds.includes(v.id);
            const statusColor = getStatusColor(v.status);

            return (
              <div
                key={v.id}
                onClick={() => onToggleSelect(v.id)}
                className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                  isSelected ? 'bg-blue-600/10 border-l-2 border-blue-500' : 'hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}} // handled by row click
                    className="rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-800 cursor-pointer"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white truncate font-mono">
                        {v.registration_number}
                      </span>
                      {loc?.is_simulated && (
                        <span className="text-[9px] font-bold px-1 rounded bg-amber-500/20 text-amber-300">
                          SIM
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 capitalize truncate">
                      {formatVehicleType(v.vehicle_type)}
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor.hex }} />
                    <span className="text-[10px] font-medium capitalize" style={{ color: statusColor.hex }}>
                      {v.status}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300">
                    {loc ? formatSpeed(loc.speed) : '--'}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
export default VehicleSelector;
