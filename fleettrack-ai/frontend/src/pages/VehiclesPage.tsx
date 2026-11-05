import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  Plus,
  Search,
  Filter,
  Navigation,
  History,
  Edit2,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { useVehicles } from '../hooks/useVehicles';
import { useAuthStore } from '../store/authStore';
import { projectService } from '../services/projectService';
import { vehicleService } from '../services/vehicleService';
import { Vehicle, Project, VehicleType, VehicleStatus } from '../types';
import { formatSpeed, formatVehicleType, getStatusColor, formatRelativeTime } from '../utils/formatters';
import { VehicleForm } from '../components/vehicles/VehicleForm';
import { Modal } from '../components/ui/Modal';

export function VehiclesPage() {
  const navigate = useNavigate();
  const { vehicles, latestLocations, refetch, setSelectedVehicleIds } = useVehicles();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [projects, setProjects] = useState<Project[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    projectService.getProjects().then(setProjects).catch(console.error);
  }, []);

  const filteredVehicles = vehicles.filter((v: Vehicle) => {
    const matchesSearch =
      v.registration_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.vehicle_type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
    const matchesType = typeFilter === 'all' || v.vehicle_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const handleDeactivate = async (id: string, reg: string) => {
    if (window.confirm(`Are you sure you want to deactivate vehicle ${reg}? Historical location records will be preserved.`)) {
      try {
        await vehicleService.deactivateVehicle(id);
        refetch();
      } catch (err) {
        alert('Failed to deactivate vehicle');
      }
    }
  };

  const handleTrackVehicle = (id: string) => {
    setSelectedVehicleIds([id]);
    navigate('/tracking');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Vehicle Management</h1>
          <p className="text-xs text-slate-400">
            {isAdmin ? 'Manage all construction vehicles, GPS assignments, and fleet allocation' : 'Manage your assigned vehicles and project dispatches'}
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow"
          >
            <Plus className="w-4 h-4" />
            <span>Add Vehicle</span>
          </button>
        )}
      </div>

      {/* Filters Bar */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by registration number or vehicle type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="moving">Moving</option>
            <option value="idle">Idle</option>
            <option value="offline">Offline</option>
            <option value="maintenance">Maintenance</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Vehicle Types</option>
            <option value="dump_truck">Dump Truck</option>
            <option value="excavator">Excavator</option>
            <option value="concrete_mixer">Concrete Mixer</option>
            <option value="loader">Loader</option>
            <option value="crane_truck">Crane Truck</option>
          </select>
        </div>
      </div>

      {/* Vehicles Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              <tr>
                <th className="py-3 px-4">Registration</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Speed</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Last Update</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No vehicles found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((v: Vehicle) => {
                  const loc = latestLocations[v.id] || v.latest_location;
                  const statusColor = getStatusColor(v.status);
                  const project = projects.find((p) => p.id === v.assigned_project_id);

                  return (
                    <tr key={v.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-xs">
                            {v.registration_number}
                          </span>
                          {loc?.is_simulated && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                              SIM
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-300 capitalize">
                        {formatVehicleType(v.vehicle_type)}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: `${statusColor.hex}22`,
                            color: statusColor.hex,
                          }}
                        >
                          {v.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-200">
                        {loc ? formatSpeed(loc.speed) : '--'}
                      </td>

                      <td className="py-3.5 px-4 text-slate-300 truncate max-w-[160px]">
                        {project ? project.name : <span className="text-slate-500">Unassigned</span>}
                      </td>

                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {loc ? formatRelativeTime(loc.recorded_at) : 'No telemetry'}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleTrackVehicle(v.id)}
                            title="Live Track"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => navigate(`/history?vehicleId=${v.id}`)}
                            title="Route History"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => setEditingVehicle(v)}
                                title="Edit Vehicle"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeactivate(v.id, v.registration_number)}
                                title="Deactivate Vehicle"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal Form */}
      <VehicleForm
        isOpen={isCreateOpen || Boolean(editingVehicle)}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingVehicle(null);
        }}
        initialData={editingVehicle}
        projects={projects}
        onSubmit={async (data) => {
          try {
            if (editingVehicle) {
              await vehicleService.updateVehicle(editingVehicle.id, data);
            } else {
              await vehicleService.createVehicle(data as any);
            }
            refetch();
          } catch (err: any) {
            alert(err?.response?.data?.detail || 'Failed to save vehicle');
            throw err;
          }
        }}
      />
    </div>
  );
}
export default VehiclesPage;
