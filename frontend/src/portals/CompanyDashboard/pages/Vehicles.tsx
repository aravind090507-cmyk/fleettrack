import React, { useEffect, useState } from 'react';
import { Truck, Plus, Filter } from 'lucide-react';
import { vehiclesApi } from '../../../services/api';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { Vehicle } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

export const Vehicles: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // New vehicle form state
  const [regNum, setRegNum] = useState('');
  const [model, setModel] = useState('');
  const [type, setType] = useState('VAN');

  const loadVehicles = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    vehiclesApi
      .list(statusFilter || undefined)
      .then((res) => setVehicles(res.items))
      .catch((e) => console.error(e))
      .finally(() => {
        if (showSpinner) setLoading(false);
      });
  };

  const socketConnected = useTelematicsStore((s) => s.socket.connected);

  useEffect(() => {
    loadVehicles(true);
    const pollInterval = socketConnected ? 60000 : 10000;
    const interval = setInterval(() => loadVehicles(false), pollInterval);
    return () => clearInterval(interval);
  }, [statusFilter, socketConnected]);

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await vehiclesApi.create({
        registration_number: regNum,
        model,
        vehicle_type: type as any,
        status: 'AVAILABLE',
      });
      setShowAddModal(false);
      setRegNum('');
      setModel('');
      loadVehicles();
    } catch (err: any) {
      alert('Error creating vehicle: ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Fleet Asset Inventory</h2>
          <p className="text-xs text-zinc-600 font-medium mt-0.5">Manage corporate assets, telematics devices, and operational statuses.</p>
        </div>

        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4 mr-1" />
          <span>Add Asset</span>
        </Button>
      </div>

      <Card>
        <div className="flex items-center justify-between pb-4 border-b border-black/[0.04]">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-600" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-zinc-200/80 rounded-full px-3.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0071E3] font-semibold shadow-sm"
            >
              <option value="">All Statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </div>
          <span className="text-xs font-bold text-zinc-700">{vehicles.length} assets registered</span>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-black/[0.03] mt-3">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50/80 text-[10px] text-zinc-700 uppercase font-bold tracking-wider border-b border-black/[0.04]">
                <tr>
                  <th className="py-3 px-4 font-bold">Plate Registration</th>
                  <th className="py-3 px-4 font-bold">Vehicle Model</th>
                  <th className="py-3 px-4 font-bold">Type</th>
                  <th className="py-3 px-4 font-bold">Operational Status</th>
                  <th className="py-3 px-4 font-bold">Fuel / Battery</th>
                  <th className="py-3 px-4 font-bold">Assigned Driver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.03] text-zinc-800 bg-white/40">
                {vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold font-mono text-zinc-900 tracking-tight">{v.registration_number}</td>
                    <td className="py-3 px-4 font-medium text-zinc-800">{v.model}</td>
                    <td className="py-3 px-4 text-zinc-700 font-medium">{v.vehicle_type}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={v.status} size="sm" />
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#0071E3]">{v.battery_or_fuel_level}%</td>
                    <td className="py-3 px-4 font-medium text-zinc-800">{v.assigned_driver_name || 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white/95 border border-white/80 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-zinc-900 tracking-tight">Register New Fleet Asset</h3>
            <form onSubmit={handleCreateVehicle} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 mb-1">Registration Plate</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KA-01-XX-9999"
                  value={regNum}
                  onChange={(e) => setRegNum(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 mb-1">Vehicle Model</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ford Transit Cargo"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 mb-1">Vehicle Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white font-medium"
                >
                  <option value="VAN">Van</option>
                  <option value="TRUCK">Truck</option>
                  <option value="CAR">Car</option>
                  <option value="MOTORCYCLE">Motorcycle</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Register Asset
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
