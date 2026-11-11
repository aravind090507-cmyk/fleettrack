import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ArrowRight } from 'lucide-react';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { journeysApi } from '../../../services/api';
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
      setJourneys(data || []);
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
    <div className="space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight">Active Dispatches & Transits</h2>
          <p className="text-xs text-zinc-500 font-medium">All vehicular movements currently underway. Click any row to view live path.</p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-sm">
          {socketConnected ? 'Live Socket Stream' : 'Safety Poll 10s'}
        </span>
      </div>

      <Card>
        {loading && journeys.length === 0 ? (
          <LoadingSpinner />
        ) : journeys.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 text-xs font-mono uppercase tracking-wider">
            No active dispatches
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-black/[0.03]">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50/80 text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-black/[0.04]">
                <tr>
                  <th className="py-3 px-4 font-bold">Vehicle</th>
                  <th className="py-3 px-4 font-bold">Driver</th>
                  <th className="py-3 px-4 font-bold">Origin Point</th>
                  <th className="py-3 px-4 font-bold">Destination</th>
                  <th className="py-3 px-4 font-bold">Departure Time</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.03] text-zinc-700 bg-white/40">
                {journeys.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                    className="hover:bg-zinc-50/60 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-bold font-mono text-[#0071E3] tracking-tight">
                      {j.vehicle_registration || 'VAN'}
                    </td>
                    <td className="py-3 px-4 font-medium text-zinc-900">{j.driver_name || 'Driver'}</td>
                    <td className="py-3 px-4 text-zinc-600">{j.origin_name}</td>
                    <td className="py-3 px-4 font-medium text-zinc-900">{j.destination_name}</td>
                    <td className="py-3 px-4 text-zinc-500 font-mono">
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
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-bold transition shadow-sm cursor-pointer"
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
