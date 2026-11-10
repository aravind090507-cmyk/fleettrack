import React, { useEffect, useState } from 'react';
import { Truck, Plus, Filter, ShieldAlert, Check } from 'lucide-react';
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-bespoke-offwhite uppercase tracking-wide">Fleet Asset Inventory</h2>
          <p className="text-xs text-bespoke-champagne/70">Manage corporate assets, telematics devices, and operational statuses.</p>
        </div>

        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4" />
          <span>Add Asset</span>
        </Button>
      </div>

      <Card>
        <div className="flex items-center justify-between pb-4 border-b border-bespoke-border">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-bespoke-dim" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-bespoke-black border border-bespoke-border rounded px-3 py-1.5 text-xs text-bespoke-champagne focus:outline-none focus:border-bespoke-gold font-mono"
            >
              <option value="">All Statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </div>
          <span className="text-xs font-mono text-bespoke-champagne/70">{vehicles.length} assets registered</span>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bespoke-black/80 text-[10px] text-bespoke-champagne uppercase tracking-[0.12em] border-b border-bespoke-border">
                <tr>
                  <th className="py-3 px-4 font-normal">Plate Registration</th>
                  <th className="py-3 px-4 font-normal">Vehicle Model</th>
                  <th className="py-3 px-4 font-normal">Type</th>
                  <th className="py-3 px-4 font-normal">Operational Status</th>
                  <th className="py-3 px-4 font-normal">Fuel / Battery</th>
                  <th className="py-3 px-4 font-normal">Assigned Driver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bespoke-border/60 text-bespoke-champagne">
                {vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-bespoke-card/50 transition-colors">
                    <td className="py-3 px-4 font-medium font-mono text-bespoke-offwhite tracking-wider">{v.registration_number}</td>
                    <td className="py-3 px-4 text-bespoke-linen">{v.model}</td>
                    <td className="py-3 px-4 text-bespoke-muted">{v.vehicle_type}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={v.status} size="sm" />
                    </td>
                    <td className="py-3 px-4 font-mono text-bespoke-gold">{v.battery_or_fuel_level}%</td>
                    <td className="py-3 px-4 text-bespoke-champagne">{v.assigned_driver_name || 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bespoke-black/85 backdrop-blur-md">
          <div className="bg-bespoke-surface border border-bespoke-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-light text-bespoke-offwhite uppercase tracking-wide">Register New Fleet Asset</h3>
            <form onSubmit={handleCreateVehicle} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-bespoke-champagne/80 mb-1">Registration Plate</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KA-01-XX-9999"
                  value={regNum}
                  onChange={(e) => setRegNum(e.target.value)}
                  className="w-full px-3 py-2 bg-bespoke-black border border-bespoke-border rounded text-xs text-bespoke-offwhite focus:outline-none focus:border-bespoke-gold"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-bespoke-champagne/80 mb-1">Vehicle Model</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ford Transit Cargo"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 bg-bespoke-black border border-bespoke-border rounded text-xs text-bespoke-offwhite focus:outline-none focus:border-bespoke-gold"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-bespoke-champagne/80 mb-1">Vehicle Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full px-3 py-2 bg-bespoke-black border border-bespoke-border rounded text-xs text-bespoke-offwhite focus:outline-none focus:border-bespoke-gold"
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
