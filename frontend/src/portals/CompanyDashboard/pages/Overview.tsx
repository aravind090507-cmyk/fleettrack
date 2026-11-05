import React, { useEffect, useState } from 'react';
import { Truck, Navigation, CheckCircle2, WifiOff, AlertTriangle, Activity } from 'lucide-react';
import { dashboardApi } from '../../../services/api';
import { ActiveVehicleTelemetry, DashboardOverview } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export const Overview: React.FC = () => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [activeVehicles, setActiveVehicles] = useState<ActiveVehicleTelemetry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = React.useCallback(() => {
    Promise.all([dashboardApi.getOverview(), dashboardApi.getActiveVehicles()])
      .then(([ov, av]) => {
        setOverview(ov);
        setActiveVehicles(av);
      })
      .catch((e) => console.error('Dashboard overview load error:', e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000); // 3s auto-refresh
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) return <LoadingSpinner label="Compiling fleet analytics..." />;

  const stats = [
    { label: 'Total Fleet Assets', value: overview?.total_vehicles || 0, icon: Truck, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Active In-Transit', value: overview?.in_transit || 0, icon: Navigation, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Active Trips', value: overview?.active_journeys || 0, icon: Activity, color: 'text-teal-400', bg: 'bg-teal-500/10' },
    { label: 'Completed Deliveries', value: overview?.completed_journeys || 0, icon: CheckCircle2, color: 'text-slate-300', bg: 'bg-slate-800' },
    { label: 'Offline / Blind Spots', value: overview?.offline_vehicles || 0, icon: WifiOff, color: 'text-rose-400', bg: 'bg-rose-500/10' },
    { label: 'Emergency Alerts', value: overview?.active_sos_alerts || 0, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ];

  return (
    <div className="space-y-6">
      {/* 6 Metric Grid Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</span>
                <div className={`p-2 rounded-xl ${s.bg} ${s.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-extrabold text-white font-mono tracking-tight">{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Fleet Live Status Table */}
      <Card title="Live Vehicular Telemetry Status">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Registration</th>
                <th className="py-3 px-4">Vehicle Model</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Assigned Driver</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Current Speed</th>
                <th className="py-3 px-4">Last Coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {activeVehicles.map((v) => (
                <tr key={v.vehicle_id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-white font-mono">{v.registration_number}</td>
                  <td className="py-3 px-4">{v.model}</td>
                  <td className="py-3 px-4 text-slate-400">{v.vehicle_type}</td>
                  <td className="py-3 px-4">{v.assigned_driver_name || 'Unassigned'}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={v.status} size="sm" />
                  </td>
                  <td className="py-3 px-4 font-mono">
                    {v.latest_speed != null ? `${v.latest_speed} km/h` : '0 km/h'}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                    {v.latest_latitude && v.latest_longitude
                      ? `${v.latest_latitude.toFixed(4)}, ${v.latest_longitude.toFixed(4)}`
                      : 'Stationary'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
