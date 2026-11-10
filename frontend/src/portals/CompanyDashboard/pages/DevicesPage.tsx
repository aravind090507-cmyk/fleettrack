import React, { useEffect, useState } from 'react';
import {
  Smartphone,
  Server,
  Activity,
  AlertTriangle,
  Clock,
  Plus,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  X,
  Gauge,
  Radio,
} from 'lucide-react';
import { devicesApi, getApiBaseUrl } from '../../../services/api';
import { Device, DeviceDiagnostics } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { useTelematicsStore } from '../../../store/telematicsStore';

export const DevicesPage: React.FC = () => {
  const storeDevices = useTelematicsStore((s) => s.devices);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedDiagnostics, setSelectedDiagnostics] = useState<DeviceDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // New device form
  const [newName, setNewName] = useState<string>('');
  const [newUniqueId, setNewUniqueId] = useState<string>('');
  const [newModel, setNewModel] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const osmandEndpoint = `${getApiBaseUrl() || window.location.origin}/osmand`;

  const loadDevices = async () => {
    try {
      setLoading(true);
      const data = await devicesApi.list();
      setDevices(data);
    } catch (err) {
      console.error('Failed to load devices:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const openDiagnostics = async (deviceId: string) => {
    try {
      setDiagnosticsLoading(true);
      const diag = await devicesApi.getDiagnostics(deviceId);
      setSelectedDiagnostics(diag);
    } catch (err) {
      alert('Failed to load diagnostics: ' + err);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUniqueId.trim() || !newName.trim()) return;

    try {
      setCreating(true);
      await devicesApi.create({
        unique_id: newUniqueId.trim(),
        name: newName.trim(),
        model: newModel.trim() || undefined,
      });
      setShowAddModal(false);
      setNewName('');
      setNewUniqueId('');
      setNewModel('');
      await loadDevices();
    } catch (err: any) {
      alert('Failed to create device: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCreating(false);
    }
  };

  const copyEndpoint = () => {
    navigator.clipboard.writeText(osmandEndpoint);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (loading) return <LoadingSpinner label="Loading telemetry devices..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-400" />
            Telematics Trackers & Hardware Devices
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage GPS hardware trackers, mobile OsmAnd agents, and diagnostic health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadDevices}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>Register Device</span>
          </Button>
        </div>
      </div>

      {/* Setup Card for Ingestion */}
      <Card title="Traccar & OsmAnd Ingestion Setup">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div>
            <p className="leading-relaxed text-slate-400">
              FleetTrack provides a high-throughput, native OsmAnd GPS ingestion endpoint. Hardware trackers (Teltonika,
              Concox, Queclink via gateway) or phones running Traccar Client can report directly here:
            </p>
            <div className="flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded-xl mt-3 font-mono text-xs">
              <span className="text-emerald-400 truncate">{osmandEndpoint}</span>
              <button
                type="button"
                onClick={copyEndpoint}
                className="ml-auto p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400">Traccar Client App Config:</span>
            <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px]">
              <li>
                <strong className="text-slate-200">Server URL:</strong> Set to the URL on the left
              </li>
              <li>
                <strong className="text-slate-200">Device Identifier:</strong> Enter the device Unique ID (e.g. IMEI or reg)
              </li>
              <li>
                <strong className="text-slate-200">Frequency:</strong> 5–10 seconds recommended
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Devices Table */}
      <Card title={`Registered Devices (${devices.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Unique ID / IMEI</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Model / Type</th>
                <th className="py-3 px-4">Last Position Fix</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No telematics devices registered yet. Click &quot;Register Device&quot; to add one.
                  </td>
                </tr>
              ) : (
                devices.map((dev) => {
                  const isOnline = dev.status === 'online';
                  const isOffline = dev.status === 'offline';
                  const statusBg = isOnline
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                    : isOffline
                    ? 'bg-rose-950/80 text-rose-400 border-rose-800'
                    : 'bg-slate-800 text-slate-400 border-slate-700';

                  return (
                    <tr key={dev.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-emerald-400" />
                        <span>{dev.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">{dev.unique_id}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${statusBg}`}>
                          {dev.status || 'unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{dev.model || dev.category || 'GPS Tracker'}</td>
                      <td className="py-3 px-4 text-slate-400">
                        {dev.last_update ? new Date(dev.last_update).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openDiagnostics(dev.id)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-950/80 text-indigo-300 border border-indigo-800 hover:bg-indigo-900 transition text-[11px] font-semibold"
                        >
                          Diagnostics
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Diagnostics Modal */}
      {selectedDiagnostics && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">
                  Diagnostics: {selectedDiagnostics.name} ({selectedDiagnostics.unique_id})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDiagnostics(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Ingestion & Clock Skew Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Ingest Lag</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  {Math.round(selectedDiagnostics.ingest_lag_ms)} ms
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Clock Skew</span>
                <span className="text-lg font-bold text-blue-400 font-mono">
                  {Math.round(selectedDiagnostics.clock_skew_ms)} ms
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Status</span>
                <span className="text-sm font-bold text-white uppercase">{selectedDiagnostics.status}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Last Seen</span>
                <span className="text-xs font-semibold text-slate-300">
                  {selectedDiagnostics.last_update
                    ? new Date(selectedDiagnostics.last_update).toLocaleTimeString()
                    : 'N/A'}
                </span>
              </div>
            </div>

            {/* Filter / Rejection Counters */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Pipeline Filter Flags & Dropped Point Counters
              </h4>
              <div className="flex flex-wrap gap-2">
                {Object.keys(selectedDiagnostics.rejection_counters).length === 0 ? (
                  <p className="text-xs text-slate-500">Zero points filtered. Pipeline clean!</p>
                ) : (
                  Object.entries(selectedDiagnostics.rejection_counters).map(([key, val]) => (
                    <div
                      key={key}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2 text-xs"
                    >
                      <span className="font-mono text-slate-300">{key}:</span>
                      <strong className="text-rose-400 font-mono">{val}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Last Rejected Points */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Last Filtered Points ({selectedDiagnostics.last_rejected_points.length})
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {selectedDiagnostics.last_rejected_points.length === 0 ? (
                  <p className="text-xs text-slate-500">No rejected coordinates recorded.</p>
                ) : (
                  selectedDiagnostics.last_rejected_points.map((pt, i) => (
                    <div
                      key={i}
                      className="p-2 bg-slate-950 border border-slate-800/80 rounded-lg flex items-center justify-between text-xs font-mono"
                    >
                      <span className="text-rose-400 font-semibold">{pt.reason}</span>
                      <span className="text-slate-400">
                        {pt.latitude.toFixed(4)}, {pt.longitude.toFixed(4)}
                      </span>
                      <span className="text-slate-500 text-[10px]">
                        {new Date(pt.device_time).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setSelectedDiagnostics(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreate}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Register Telematics Device</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Device Name / Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delivery Van GPS 01"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Unique Identifier / IMEI / Phone ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 123456 or 864501041234567"
                  value={newUniqueId}
                  onChange={(e) => setNewUniqueId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Must match the Device ID entered in Traccar Client or GPS hardware firmware.
                </p>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Tracker Model (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Teltonika FMB920 or Traccar Client"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={creating}>
                {creating ? 'Registering...' : 'Register Device'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
