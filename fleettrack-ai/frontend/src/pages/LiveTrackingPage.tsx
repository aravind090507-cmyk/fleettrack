import React, { useState, useEffect } from 'react';
import { useVehicles } from '../hooks/useVehicles';
import { projectService } from '../services/projectService';
import { FleetMap } from '../components/map/FleetMap';
import { VehicleSelector } from '../components/tracking/VehicleSelector';
import { TrackingPanel } from '../components/tracking/TrackingPanel';
import { Project, Vehicle } from '../types';
import { Radio, AlertCircle } from 'lucide-react';

export function LiveTrackingPage() {
  const {
    vehicles,
    latestLocations,
    selectedVehicleIds,
    toggleVehicleSelection,
    selectAllVehicles,
    clearVehicleSelection,
    setSelectedVehicleIds,
  } = useVehicles();

  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    projectService.getProjects().then(setProjects).catch(console.error);
  }, []);

  const selectedVehicle =
    selectedVehicleIds.length === 1
      ? vehicles.find((v: Vehicle) => v.id === selectedVehicleIds[0])
      : null;

  return (
    <div className="h-[calc(100vh-6.5rem)] flex flex-col gap-3">
      {/* Simulation Info Strip */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-white">Live Tracking Stream:</span>
          <span>Receiving real-time GPS coordinates every 5 seconds via WebSockets.</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400">
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono text-[10px]">
            [SIM] Realistic Arterial Corridors Active
          </span>
        </div>
      </div>

      {/* Main 3-Column / Responsive Tracking Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0">
        {/* Left: Vehicle Selector (3 Cols) */}
        <div className="lg:col-span-3 h-full min-h-0">
          <VehicleSelector
            vehicles={vehicles}
            locations={latestLocations}
            selectedIds={selectedVehicleIds}
            onToggleSelect={toggleVehicleSelection}
            onSelectAll={selectAllVehicles}
            onClearSelection={clearVehicleSelection}
          />
        </div>

        {/* Center: Interactive Map (6 or 9 Cols depending on right panel) */}
        <div
          className={`${
            selectedVehicle ? 'lg:col-span-6' : 'lg:col-span-9'
          } h-full min-h-[350px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden relative shadow-lg`}
        >
          <FleetMap
            vehicles={vehicles}
            locations={latestLocations}
            selectedVehicleIds={selectedVehicleIds}
            onVehicleSelect={(id: string) => setSelectedVehicleIds([id])}
            height="100%"
          />
        </div>

        {/* Right: Selected Vehicle Telemetry & ETA Panel (3 Cols) */}
        {selectedVehicle && (
          <div className="lg:col-span-3 h-full min-h-0">
            <TrackingPanel
              vehicle={selectedVehicle}
              location={latestLocations[selectedVehicle.id]}
              projects={projects}
              onClose={() => clearVehicleSelection()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
export default LiveTrackingPage;
