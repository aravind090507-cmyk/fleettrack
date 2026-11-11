import React, { useEffect, useState } from 'react';
import { Truck, Navigation, CheckCircle2, WifiOff, AlertTriangle, Activity } from 'lucide-react';
import { dashboardApi } from '../../../services/api';
import { ActiveVehicleTelemetry, DashboardOverview } from '../../../types';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { useFleetStore } from '../../../store/fleetStore';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export const Overview: React.FC = () => {
  const socketConnected = useTelematicsStore((s) => s.socket.connected);
  const { overview, activeVehicles, setOverview, setActiveVehicles } = useFleetStore();
  const [loading, setLoading] = useState<boolean>(!overview);

  const loadData = React.useCallback(() => {
    Promise.all([dashboardApi.getOverview(), dashboardApi.getActiveVehicles()])
      .then(([ov, av]) => {
        setOverview(ov);
        setActiveVehicles(av);
      })
      .catch((e) => console.error('Dashboard overview load error:', e))
      .finally(() => setLoading(false));
  }, [setOverview, setActiveVehicles]);

  useEffect(() => {
    loadData();
    const pollInterval = socketConnected ? 60000 : 10000;
    const interval = setInterval(loadData, pollInterval);
    return () => clearInterval(interval);
  }, [loadData, socketConnected]);

  if (loading) return <LoadingSpinner label="Compiling fleet analytics..." />;

  const stats = [
    { label: 'Total Fleet Assets', value: overview?.total_vehicles || 0, icon: Truck, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'Active In-Transit', value: overview?.in_transit || 0, icon: Navigation, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
    { label: 'Active Trips', value: overview?.active_journeys || 0, icon: Activity, color: 'text-indigo-600', bg: 'bg-indigo-500/10' },
    { label: 'Completed Deliveries', value: overview?.completed_journeys || 0, icon: CheckCircle2, color: 'text-teal-600', bg: 'bg-teal-500/10' },
    { label: 'Offline Units', value: overview?.offline_vehicles || 0, icon: WifiOff, color: 'text-zinc-500', bg: 'bg-zinc-100' },
    { label: 'Emergency Alerts', value: overview?.active_sos_alerts || 0, icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
  ];

  return (
    <div className="space-y-6 font-sans">
      {/* 6 Apple Metric Grid Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={i}
              className="bg-white/85 border border-white/80 rounded-3xl p-4 shadow-sm backdrop-blur-xl flex flex-col justify-between hover:shadow-md transition-all hover:scale-[1.02]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{s.label}</span>
                <div className={`p-2 rounded-2xl ${s.bg} ${s.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-extrabold text-zinc-900 tracking-tight">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Fleet Live Status Table */}
      <div className="bg-white/85 border border-white/80 rounded-3xl p-6 shadow-sm backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-zinc-900 tracking-tight">Active Vehicular Telemetry Status</h3>
            <p className="text-xs text-zinc-500 font-medium">Real-time GPS positioning and mission telemetry across fleet</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-[#0071E3] border border-blue-200/60">
            {activeVehicles.length} Units Online
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-black/[0.04]">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50/80 text-zinc-500 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.04]">
              <tr>
                <th className="py-3 px-4 font-bold">Registration</th>
                <th className="py-3 px-4 font-bold">Model</th>
                <th className="py-3 px-4 font-bold">Type</th>
                <th className="py-3 px-4 font-bold">Driver</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold">Active Route</th>
                <th className="py-3 px-4 font-bold">Speed</th>
                <th className="py-3 px-4 font-bold">Coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.03] text-zinc-700 bg-white/40">
              {activeVehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-400 text-xs font-mono uppercase tracking-wider">
                    No active dispatches
                  </td>
                </tr>
              ) : (
                activeVehicles.map((v) => (
                  <tr key={v.vehicle_id} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-zinc-900 font-mono tracking-tight">{v.registration_number}</td>
                    <td className="py-3 px-4 font-medium text-zinc-800">{v.model}</td>
                    <td className="py-3 px-4 text-zinc-500">{v.vehicle_type}</td>
                    <td className="py-3 px-4 font-medium text-zinc-900">{v.assigned_driver_name || 'Unassigned'}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={v.status} size="sm" />
                    </td>
                    <td className="py-3 px-4">
                      {v.origin_name && v.destination_name ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                          <span className="text-zinc-800 font-semibold truncate max-w-[120px]" title={v.origin_name}>
                            {v.origin_name}
                          </span>
                          <span className="text-zinc-400">&rarr;</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="text-zinc-800 font-semibold truncate max-w-[120px]" title={v.destination_name}>
                            {v.destination_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-zinc-400 italic text-[11px]">No active dispatch</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-zinc-900">
                      {v.latest_speed != null ? `${v.latest_speed} km/h` : '0 km/h'}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-zinc-500">
                      {v.latest_latitude && v.latest_longitude
                        ? `${v.latest_latitude.toFixed(4)}, ${v.latest_longitude.toFixed(4)}`
                        : '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
