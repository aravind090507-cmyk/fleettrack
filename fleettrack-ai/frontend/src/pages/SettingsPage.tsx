import React, { useState, useEffect } from 'react';
import { Settings, Play, Pause, Square, Radio, Shield, Cpu, MapPin, CheckCircle, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

export function SettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [simStatus, setSimStatus] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);

  const fetchSimStatus = async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get('/api/v1/simulator/status');
      setSimStatus(res.data);
    } catch (err) {
      console.error('Failed to get simulator status:', err);
    }
  };

  useEffect(() => {
    fetchSimStatus();
    const interval = setInterval(fetchSimStatus, 5000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const handleSimAction = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    setSimLoading(true);
    try {
      await api.post(`/api/v1/simulator/${action}`);
      await fetchSimStatus();
    } catch (err) {
      alert(`Failed to ${action} simulator`);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">System Configuration & Settings</h1>
        <p className="text-xs text-slate-400">
          Manage user profile, simulation parameters, telemetry ingestion, and integration keys.
        </p>
      </div>

      {/* Profile Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Shield className="w-4 h-4 text-blue-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">User Account Profile</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px] mb-1">Full Name</span>
            <span className="font-semibold text-white">{user?.name}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px] mb-1">Email Address</span>
            <span className="font-mono text-white">{user?.email}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px] mb-1">Authorized Role</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {user?.role.replace('_', ' ')}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px] mb-1">Account Status</span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active
            </span>
          </div>
        </div>
      </div>

      {/* GPS Simulation Control Center (Admin Only) */}
      {isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                GPS Route Simulator Engine
              </h2>
            </div>
            {simStatus && (
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                  simStatus.running && !simStatus.paused
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : simStatus.paused
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}
              >
                {simStatus.running && !simStatus.paused
                  ? 'Running (5s ticks)'
                  : simStatus.paused
                  ? 'Paused'
                  : 'Stopped'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            The simulator broadcasts realistic continuous vehicle movements across 5 arterial corridors in Chennai, India. Telemetry is dual-written to historical stores and broadcasted to connected WebSockets every 5 seconds.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              onClick={() => handleSimAction(simStatus?.paused ? 'resume' : 'start')}
              disabled={simLoading || (simStatus?.running && !simStatus?.paused)}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{simStatus?.paused ? 'Resume Simulation' : 'Start Simulation'}</span>
            </button>

            <button
              onClick={() => handleSimAction('pause')}
              disabled={simLoading || !simStatus?.running || simStatus?.paused}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>

            <button
              onClick={() => handleSimAction('stop')}
              disabled={simLoading || !simStatus?.running}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop Engine</span>
            </button>
          </div>
        </div>
      )}

      {/* Integration Status Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Cpu className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            External Integrations & Fallbacks
          </h2>
        </div>

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg flex items-center justify-between">
            <div>
              <span className="font-semibold text-white block">Google Maps Platform</span>
              <span className="text-[11px] text-slate-400">
                Maps JavaScript API, Directions & Routing
              </span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              Graceful Radar Fallback Ready
            </span>
          </div>

          <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg flex items-center justify-between">
            <div>
              <span className="font-semibold text-white block">AI Operational Assistant</span>
              <span className="text-[11px] text-slate-400">
                OpenAI-compatible LLM provider or deterministic database analysis engine
              </span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
              Hybrid Mode Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
export default SettingsPage;
