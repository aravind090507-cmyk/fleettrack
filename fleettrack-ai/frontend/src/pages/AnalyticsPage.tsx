import React, { useState, useEffect } from 'react';
import { BarChart3, Calendar, Filter, Truck, ArrowDown, ArrowUp } from 'lucide-react';
import { analyticsService } from '../services/analyticsService';
import { projectService } from '../services/projectService';
import { useVehicles } from '../hooks/useVehicles';
import { DistanceChart } from '../components/charts/DistanceChart';
import { ActivityChart } from '../components/charts/ActivityChart';
import { SpeedChart } from '../components/charts/SpeedChart';
import { FleetSummary, VehicleActivity, Project } from '../types';
import { formatVehicleType } from '../utils/formatters';

export function AnalyticsPage() {
  const { vehicles } = useVehicles();
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [dailyData, setDailyData] = useState<{ date: string; distance_km: number }[]>([]);
  const [activityData, setActivityData] = useState<VehicleActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [days, setDays] = useState(30);
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');

  useEffect(() => {
    projectService.getProjects().then(setProjects).catch(console.error);
  }, []);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const vId = selectedVehicle !== 'all' ? selectedVehicle : undefined;
      const pId = selectedProject !== 'all' ? selectedProject : undefined;

      const [sumRes, dailyRes, actRes] = await Promise.all([
        analyticsService.getFleetSummary(),
        analyticsService.getDailyDistance({ days, vehicle_id: vId, project_id: pId }),
        analyticsService.getVehicleActivity({ vehicle_id: vId, project_id: pId }),
      ]);

      setSummary(sumRes);
      setDailyData(dailyRes);
      setActivityData(actRes);
    } catch (err) {
      console.error('Failed to load analytics metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [days, selectedVehicle, selectedProject]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Fleet Analytics & Performance</h1>
          <p className="text-xs text-slate-400">
            Telemetry trends, operational utilization, speed profiles, and field distance audits.
          </p>
        </div>

        {/* Global Filter Bar */}
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={60}>Last 60 Days</option>
          </select>

          <select
            value={selectedVehicle}
            onChange={(e) => setSelectedVehicle(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Vehicles</option>
            {vehicles.map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.registration_number}
              </option>
            ))}
          </select>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 1: Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <DistanceChart data={dailyData} title={`Daily Fleet Distance (Past ${days} Days)`} />
        </div>
        <div className="lg:col-span-4">
          <ActivityChart summary={summary} />
        </div>
      </div>

      {/* Row 2: Speed Profiles */}
      <div className="grid grid-cols-1 gap-4">
        <SpeedChart data={activityData} />
      </div>

      {/* Row 3: Vehicle Activity Metrics Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Vehicle Utilization & Field Metrics
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              <tr>
                <th className="py-3 px-4">Vehicle</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Total Distance</th>
                <th className="py-3 px-4">Moving Time</th>
                <th className="py-3 px-4">Idle Time</th>
                <th className="py-3 px-4">Max Speed</th>
                <th className="py-3 px-4">Avg Speed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activityData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No activity data available for the chosen filters.
                  </td>
                </tr>
              ) : (
                activityData.map((a) => (
                  <tr key={a.vehicle_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white font-mono">{a.registration_number}</td>
                    <td className="py-3 px-4 text-slate-300 capitalize">{formatVehicleType((a as any).vehicle_type || 'truck')}</td>
                    <td className="py-3 px-4 font-mono text-blue-400 font-semibold">{a.total_distance_km} km</td>
                    <td className="py-3 px-4 font-mono text-emerald-400">{a.moving_time_hours || (a as any).moving_hours || 0} hrs</td>
                    <td className="py-3 px-4 font-mono text-amber-400">{a.idle_time_hours || (a as any).idle_hours || 0} hrs</td>
                    <td className="py-3 px-4 font-mono text-slate-200">{a.max_speed} km/h</td>
                    <td className="py-3 px-4 font-mono text-slate-200">{a.avg_speed} km/h</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
export default AnalyticsPage;
