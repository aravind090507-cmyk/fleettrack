import React, { useEffect, useState } from 'react';
import { Truck, Navigation, CheckCircle2, WifiOff, AlertTriangle, Activity } from 'lucide-react';
import { dashboardApi } from '../../../services/api';
import { ActiveVehicleTelemetry, DashboardOverview } from '../../../types';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { useFleetStore } from '../../../store/fleetStore';
import { Card } from '../../../components/ui/Card';
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
    // 60s safety refresh, 10s if socket is down
    const pollInterval = socketConnected ? 60000 : 10000;
    const interval = setInterval(loadData, pollInterval);
    return () => clearInterval(interval);
  }, [loadData, socketConnected]);

  if (loading) return <LoadingSpinner label="Compiling fleet analytics..." />;

  const stats = [
    { label: 'Total Fleet Assets', value: overview?.total_vehicles || 0, icon: Truck, color: 'text-bespoke-champagne', bg: 'bg-bespoke-surface border border-bespoke-border' },
    { label: 'Active In-Transit', value: overview?.in_transit || 0, icon: Navigation, color: 'text-bespoke-gold', bg: 'bg-bespoke-gold/10 border border-bespoke-gold/25' },
    { label: 'Active Trips', value: overview?.active_journeys || 0, icon: Activity, color: 'text-bespoke-goldLight', bg: 'bg-bespoke-goldLight/10 border border-bespoke-goldLight/20' },
    { label: 'Completed Deliveries', value: overview?.completed_journeys || 0, icon: CheckCircle2, color: 'text-bespoke-linen', bg: 'bg-bespoke-surface border border-bespoke-border' },
    { label: 'Offline / Blind Spots', value: overview?.offline_vehicles || 0, icon: WifiOff, color: 'text-bespoke-dim', bg: 'bg-bespoke-card border border-bespoke-border' },
    { label: 'Emergency Alerts', value: overview?.active_sos_alerts || 0, icon: AlertTriangle, color: 'text-bespoke-error', bg: 'bg-bespoke-error/10 border border-bespoke-error/30' },
  ];

  return (
    <div className="space-y-6">
      {/* 6 Metric Grid Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4 flex flex-col justify-between hover:border-bespoke-gold/40 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold text-bespoke-champagne/70 uppercase tracking-[0.12em]">{s.label}</span>
                <div className={`p-2 rounded-lg ${s.bg} ${s.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-light text-bespoke-offwhite tracking-tight font-sans">{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Fleet Live Status Table */}
      <Card title="Live Vehicular Telemetry Status">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-bespoke-black/80 text-bespoke-champagne uppercase text-[10px] tracking-[0.12em] border-b border-bespoke-border">
              <tr>
                <th className="py-3 px-4 font-normal">Registration</th>
                <th className="py-3 px-4 font-normal">Vehicle Model</th>
                <th className="py-3 px-4 font-normal">Type</th>
                <th className="py-3 px-4 font-normal">Assigned Driver</th>
                <th className="py-3 px-4 font-normal">Status</th>
                <th className="py-3 px-4 font-normal">Active Route (Source &rarr; Destination)</th>
                <th className="py-3 px-4 font-normal">Current Speed</th>
                <th className="py-3 px-4 font-normal">Last Coordinates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bespoke-border/60 text-bespoke-champagne">
              {activeVehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-bespoke-dim text-xs font-mono tracking-wider uppercase">
                    No active dispatches
                  </td>
                </tr>
              ) : (
                activeVehicles.map((v) => (
                <tr key={v.vehicle_id} className="hover:bg-bespoke-card/50 transition-colors">
                  <td className="py-3 px-4 font-medium text-bespoke-offwhite font-mono tracking-wider">{v.registration_number}</td>
                  <td className="py-3 px-4 text-bespoke-linen">{v.model}</td>
                  <td className="py-3 px-4 text-bespoke-muted">{v.vehicle_type}</td>
                  <td className="py-3 px-4 text-bespoke-champagne">{v.assigned_driver_name || 'Unassigned'}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={v.status} size="sm" />
                  </td>
                  <td className="py-3 px-4">
                    {v.origin_name && v.destination_name ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-bespoke-gold shrink-0" />
                        <span className="text-bespoke-goldLight font-medium truncate max-w-[120px]" title={v.origin_name}>
                          {v.origin_name}
                        </span>
                        <span className="text-bespoke-dim">&rarr;</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-bespoke-champagne shrink-0" />
                        <span className="text-bespoke-offwhite font-medium truncate max-w-[120px]" title={v.destination_name}>
                          {v.destination_name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-bespoke-dim italic text-[11px]">No active dispatch</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-bespoke-offwhite">
                    {v.latest_speed != null ? `${v.latest_speed} km/h` : '0 km/h'}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-bespoke-muted">
                    {v.latest_latitude && v.latest_longitude
                      ? `${v.latest_latitude.toFixed(4)}, ${v.latest_longitude.toFixed(4)}`
                      : 'Stationary'}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
