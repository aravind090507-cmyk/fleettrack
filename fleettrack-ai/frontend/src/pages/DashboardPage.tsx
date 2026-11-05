import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  Activity,
  Navigation,
  Clock,
  WifiOff,
  Wrench,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useVehicles } from '../hooks/useVehicles';
import { analyticsService } from '../services/analyticsService';
import { vehicleService } from '../services/vehicleService';
import { KPICard } from '../components/dashboard/KPICard';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { FleetMap } from '../components/map/FleetMap';
import { FleetSummary } from '../types';

export function DashboardPage() {
  const navigate = useNavigate();
  const { vehicles, latestLocations, selectedVehicleIds, setSelectedVehicleIds } = useVehicles();
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [sumRes, evRes] = await Promise.all([
          analyticsService.getFleetSummary(),
          vehicleService.getVehicleEvents(15),
        ]);
        setSummary(sumRes);
        setRecentEvents(evRes);
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Fleet Overview Dashboard</h1>
          <p className="text-xs text-slate-400">
            Real-time status, vehicle locations, and ongoing construction site activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/tracking')}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Open Live Tracking</span>
          </button>
          <button
            onClick={() => navigate('/ai-insights')}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>AI Fleet Insights</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row (Calculated from DB) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard
          title="Total Vehicles"
          value={summary?.total_vehicles ?? vehicles.length}
          icon={<Truck className="w-5 h-5" />}
          variant="blue"
        />
        <KPICard
          title="Active Vehicles"
          value={summary?.active_vehicles ?? 0}
          icon={<Activity className="w-5 h-5" />}
          variant="emerald"
        />
        <KPICard
          title="Moving"
          value={summary?.moving_vehicles ?? 0}
          icon={<Navigation className="w-5 h-5" />}
          variant="emerald"
        />
        <KPICard
          title="Idle at Site"
          value={summary?.idle_vehicles ?? 0}
          icon={<Clock className="w-5 h-5" />}
          variant="amber"
        />
        <KPICard
          title="Offline"
          value={summary?.offline_vehicles ?? 0}
          icon={<WifiOff className="w-5 h-5" />}
          variant="red"
        />
        <KPICard
          title="In Maintenance"
          value={summary?.maintenance_vehicles ?? 0}
          icon={<Wrench className="w-5 h-5" />}
          variant="purple"
        />
      </div>

      {/* Two Column Layout: Map & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Map Area (8 Cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                Live Geographic Positions
              </h2>
            </div>
            <span className="text-[11px] text-slate-400">
              Auto-updating every 5s • Click markers for details
            </span>
          </div>

          <div className="h-[480px] w-full rounded-lg overflow-hidden border border-slate-800">
            <FleetMap
              vehicles={vehicles}
              locations={latestLocations}
              selectedVehicleIds={selectedVehicleIds}
              onVehicleSelect={(id: string) => setSelectedVehicleIds([id])}
              height="100%"
            />
          </div>
        </div>

        {/* Activity Stream Area (4 Cols) */}
        <div className="lg:col-span-4 h-[535px] flex flex-col">
          <RecentActivity events={recentEvents} />
        </div>
      </div>
    </div>
  );
}
export default DashboardPage;
