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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-bespoke-offwhite tracking-wide uppercase">Active Dispatches & Transits</h2>
          <p className="text-xs text-bespoke-champagne/70">All vehicular movements currently underway. Click any row to view live path.</p>
        </div>
        <span className="text-[10px] font-mono tracking-[0.12em] text-bespoke-gold bg-bespoke-gold/10 px-3 py-1 rounded-full border border-bespoke-gold/30 uppercase">
          {socketConnected ? 'Live Socket Stream' : 'Safety Poll 10s'}
        </span>
      </div>

      <Card>
        {loading && journeys.length === 0 ? (
          <LoadingSpinner />
        ) : journeys.length === 0 ? (
          <div className="text-center py-12 text-bespoke-dim text-xs font-mono uppercase tracking-wider">
            No active dispatches
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bespoke-black/80 text-[10px] text-bespoke-champagne uppercase tracking-[0.12em] border-b border-bespoke-border">
                <tr>
                  <th className="py-3 px-4 font-normal">Vehicle</th>
                  <th className="py-3 px-4 font-normal">Driver</th>
                  <th className="py-3 px-4 font-normal">Origin Point</th>
                  <th className="py-3 px-4 font-normal">Destination</th>
                  <th className="py-3 px-4 font-normal">Departure Time</th>
                  <th className="py-3 px-4 font-normal">Status</th>
                  <th className="py-3 px-4 font-normal text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bespoke-border/60 text-bespoke-champagne">
                {journeys.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                    className="hover:bg-bespoke-card/60 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-medium font-mono text-bespoke-gold tracking-wider">
                      {j.vehicle_registration || 'VAN'}
                    </td>
                    <td className="py-3 px-4 font-medium text-bespoke-offwhite">{j.driver_name || 'Driver'}</td>
                    <td className="py-3 px-4 text-bespoke-champagne">{j.origin_name}</td>
                    <td className="py-3 px-4 font-medium text-bespoke-linen">{j.destination_name}</td>
                    <td className="py-3 px-4 text-bespoke-muted font-mono">
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
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-bespoke-gold hover:bg-bespoke-goldHover text-bespoke-black rounded text-[11px] font-semibold uppercase tracking-[0.08em] transition shadow-sm"
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
