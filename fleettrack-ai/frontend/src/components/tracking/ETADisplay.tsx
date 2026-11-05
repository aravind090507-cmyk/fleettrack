import React, { useState } from 'react';
import { Compass, Clock, MapPin, Navigation, Sparkles } from 'lucide-react';
import { Vehicle, Project } from '../../types';
import { locationService } from '../../services/locationService';

interface ETADisplayProps {
  vehicle: Vehicle;
  projects?: Project[];
}

export function ETADisplay({ vehicle, projects = [] }: ETADisplayProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    vehicle.assigned_project_id || (projects[0]?.id || '')
  );
  const [loading, setLoading] = useState(false);
  const [etaResult, setEtaResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCalculate = async () => {
    const targetProject = projects.find((p) => p.id === selectedProjectId);
    if (!targetProject || targetProject.latitude === undefined || targetProject.longitude === undefined) {
      setError('Please select a destination project with coordinates.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await locationService.getETA(
        vehicle.id,
        targetProject.latitude,
        targetProject.longitude,
        targetProject.name
      );
      setEtaResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to calculate ETA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-white uppercase tracking-wider">
        <Navigation className="w-3.5 h-3.5 text-blue-400" />
        <span>Destination & ETA</span>
      </div>

      {/* Destination Select */}
      <div className="space-y-1">
        <label className="text-[10px] text-slate-400 uppercase font-semibold">Select Destination</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading}
        className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow"
      >
        <Clock className="w-3.5 h-3.5" />
        {loading ? 'Calculating...' : 'Calculate ETA'}
      </button>

      {error && <div className="text-[11px] text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">{error}</div>}

      {etaResult && (
        <div className="p-2.5 bg-slate-800/80 border border-slate-700 rounded-lg space-y-2 text-xs animate-in fade-in">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-[11px]">Remaining Distance:</span>
            <span className="font-bold text-white font-mono">{etaResult.distance_text || `${etaResult.distance_km} km`}</span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-[11px]">Estimated Travel Time:</span>
            <span className="font-bold text-emerald-400 font-mono">{etaResult.duration_text || `${etaResult.duration_minutes} min`}</span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-[11px]">Estimated Arrival:</span>
            <span className="font-mono text-white text-[11px]">
              {new Date(etaResult.estimated_arrival_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="pt-1 border-t border-slate-700/60 flex items-center justify-between text-[10px] text-slate-500">
            <span>Provider:</span>
            <span className="capitalize">{etaResult.source === 'google_maps_api' ? 'Google Maps API' : 'Calculated Model'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
export default ETADisplay;
