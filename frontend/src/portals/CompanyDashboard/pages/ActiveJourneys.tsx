import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Route, Clock, Navigation, MapPin, ArrowRight } from 'lucide-react';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { journeysApi, trackingApi } from '../../../services/api';
import { Journey } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

export const ActiveJourneys: React.FC = () => {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  const loadActive = useCallback(async () => {
    try {
      const data = await journeysApi.getActive();
      let list = [...data];
      const localToken = localStorage.getItem('fleet_active_token');
      if (localToken && !list.some((j) => (j as any).tracking_token === localToken)) {
        try {
          const info = await trackingApi.getInfo(localToken);
          if (info && info.journey_id && !list.some((j) => j.id === info.journey_id)) {
            list.push({
              id: info.journey_id,
              vehicle_id: info.vehicle_id || 'veh-active',
              driver_id: info.driver_id || 'drv-active',
              origin_name: info.origin_name,
              origin_lat: info.origin_lat,
              origin_lng: info.origin_lng,
              destination_name: info.destination_name,
              destination_lat: info.destination_lat,
              destination_lng: info.destination_lng,
              status: info.status as any,
              total_distance_km: 0,
              duration_seconds: 0,
              started_at: info.started_at,
              created_at: info.started_at,
              vehicle_registration: info.vehicle_registration,
              driver_name: info.driver_name,
            });
          }
        } catch {}
      }
      setJourneys(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const socketConnected = useTelematicsStore((s) => s.socket.connected);

  useEffect(() => {
    loadActive();
    const pollInterval = socketConnected ? 60000 : 10000;
    const interval = setInterval(loadActive, pollInterval);
    return () => clearInterval(interval);
  }, [loadActive, socketConnected]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Active Dispatches & Transits</h2>
          <p className="text-xs text-slate-400">All vehicular movements currently underway. Click any row to view live path.</p>
        </div>
        <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded-full border border-emerald-800">
          {socketConnected ? 'Live Socket Stream' : 'Safety Poll 10s'}
        </span>
      </div>

      <Card>
        {loading && journeys.length === 0 ? (
          <LoadingSpinner />
        ) : journeys.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No active journeys in transit currently.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4">Driver</th>
                  <th className="py-3 px-4">Origin Point</th>
                  <th className="py-3 px-4">Destination</th>
                  <th className="py-3 px-4">Departure Time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {journeys.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-bold font-mono text-emerald-400">
                      {j.vehicle_registration || 'VAN'}
                    </td>
                    <td className="py-3 px-4 font-medium text-white">{j.driver_name || 'Driver'}</td>
                    <td className="py-3 px-4 text-slate-300">{j.origin_name}</td>
                    <td className="py-3 px-4 font-semibold text-white">{j.destination_name}</td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(j.started_at).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={j.status} size="sm" />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/company/live-map?journeyId=${j.id}`);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition shadow-sm"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>Track Route</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
