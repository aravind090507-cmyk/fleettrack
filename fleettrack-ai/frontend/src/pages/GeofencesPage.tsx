import React, { useState, useEffect } from 'react';
import { ShieldAlert, Plus, MapPin, Trash2, Edit2, CheckCircle2, XCircle } from 'lucide-react';
import { projectService } from '../services/projectService';
import { useAuthStore } from '../store/authStore';
import { FleetMap } from '../components/map/FleetMap';
import { Modal } from '../components/ui/Modal';
import { Geofence, Project } from '../types';
import api from '../services/api';

export function GeofencesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [geofenceType, setGeofenceType] = useState<'circle' | 'polygon'>('circle');
  const [centerLat, setCenterLat] = useState('13.0067');
  const [centerLng, setCenterLng] = useState('80.2025');
  const [radiusMeters, setRadiusMeters] = useState('800');

  const fetchGeofences = async () => {
    try {
      const [gfRes, prjRes] = await Promise.all([
        api.get('/api/v1/geofences'),
        projectService.getProjects(),
      ]);
      setGeofences(gfRes.data);
      setProjects(prjRes);
    } catch (err) {
      console.error('Failed to load geofences:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGeofences();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name,
        project_id: projectId || null,
        geofence_type: geofenceType,
        is_active: true,
      };

      if (geofenceType === 'circle') {
        payload.center_latitude = parseFloat(centerLat);
        payload.center_longitude = parseFloat(centerLng);
        payload.radius_meters = parseFloat(radiusMeters);
      } else {
        // Default polygon around center for simplicity
        const lat = parseFloat(centerLat);
        const lng = parseFloat(centerLng);
        payload.polygon_coordinates = [
          { lat: lat - 0.004, lng: lng - 0.004 },
          { lat: lat + 0.004, lng: lng - 0.004 },
          { lat: lat + 0.004, lng: lng + 0.004 },
          { lat: lat - 0.004, lng: lng + 0.004 },
        ];
      }

      await api.post('/api/v1/geofences', payload);
      setIsModalOpen(false);
      fetchGeofences();
    } catch (err) {
      alert('Failed to create geofence');
    }
  };

  const handleDelete = async (id: string, gfName: string) => {
    if (window.confirm(`Are you sure you want to delete geofence '${gfName}'?`)) {
      try {
        await api.delete(`/api/v1/geofences/${id}`);
        fetchGeofences();
      } catch (err) {
        alert('Failed to delete geofence');
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Geofencing & Boundary Zones</h1>
          <p className="text-xs text-slate-400">
            Define virtual site perimeters to automatically track entries, departures, and unauthorized dwell times.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => {
              setName('');
              setIsModalOpen(true);
            }}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Create Geofence</span>
          </button>
        )}
      </div>

      {/* Main Split Layout: Geofences List on Left (4 cols), Map on Right (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left List (4 Cols) */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Active Geofence Zones ({geofences.length})
            </h2>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-[500px]">
            {geofences.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No geofences created yet.
              </div>
            ) : (
              geofences.map((gf) => {
                const project = projects.find((p) => p.id === gf.project_id);
                return (
                  <div
                    key={gf.id}
                    className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-bold text-xs text-white block">{gf.name}</span>
                        <span className="text-[10px] text-slate-400 capitalize">
                          {gf.geofence_type} {gf.radius_meters ? `• ${gf.radius_meters}m radius` : ''}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                          gf.is_active
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {gf.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <span>Project:</span>
                      <span className="text-slate-300 truncate max-w-[150px]">
                        {project ? project.name : 'Unassigned'}
                      </span>
                    </div>

                    {isAdmin && (
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleDelete(gf.id, gf.name)}
                          className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Map (8 Cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm h-[560px]">
          <FleetMap
            vehicles={[]}
            locations={{}}
            geofences={geofences}
            height="100%"
          />
        </div>
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Geofence Perimeter"
      >
        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="text-slate-300 font-semibold">Geofence Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kathipara Worksite Zone"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-semibold">Assign Construction Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">No Project Assigned</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-semibold">Geofence Geometry Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGeofenceType('circle')}
                className={`py-2 rounded-lg font-semibold text-center border transition-all ${
                  geofenceType === 'circle'
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                Circle Perimeter
              </button>
              <button
                type="button"
                onClick={() => setGeofenceType('polygon')}
                className={`py-2 rounded-lg font-semibold text-center border transition-all ${
                  geofenceType === 'polygon'
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                Polygon Perimeter
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Center Latitude</label>
              <input
                type="number"
                step="any"
                value={centerLat}
                onChange={(e) => setCenterLat(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Center Longitude</label>
              <input
                type="number"
                step="any"
                value={centerLng}
                onChange={(e) => setCenterLng(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          </div>

          {geofenceType === 'circle' && (
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold">Radius (Meters)</label>
              <input
                type="number"
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow"
            >
              Create Geofence
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
export default GeofencesPage;
