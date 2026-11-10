import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Calendar, CheckCircle, MapPin, ArrowRight, Download, Play } from 'lucide-react';
import { journeysApi } from '../../../services/api';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { Journey } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

export const JourneyHistory: React.FC = () => {
  const [history, setHistory] = useState<Journey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  const loadHistory = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    journeysApi
      .getHistory(0, 50)
      .then((data) => setHistory(data))
      .catch((e) => console.error(e))
      .finally(() => {
        if (showSpinner) setLoading(false);
      });
  };

  const exportToCsv = () => {
    if (history.length === 0) return;
    const headers = ['Journey ID', 'Vehicle', 'Driver', 'Origin', 'Destination', 'Date', 'Duration (mins)', 'Distance (km)', 'Status'];
    const rows = history.map((j) => [
      j.id,
      j.vehicle_registration || '',
      j.driver_name || '',
      `"${(j.origin_name || '').replace(/"/g, '""')}"`,
      `"${(j.destination_name || '').replace(/"/g, '""')}"`,
      new Date(j.started_at).toISOString(),
      Math.floor(j.duration_seconds / 60),
      j.total_distance_km,
      j.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `fleettrack_journey_history_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const socketConnected = useTelematicsStore((s) => s.socket.connected);

  useEffect(() => {
    loadHistory(true);
    const pollInterval = socketConnected ? 60000 : 10000;
    const interval = setInterval(() => loadHistory(false), pollInterval);
    return () => clearInterval(interval);
  }, [socketConnected]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-light text-bespoke-offwhite tracking-wide uppercase">Trip Archives & Historical Records</h2>
          <p className="text-xs text-bespoke-champagne/70">Completed journey records, duration metrics, and distance audit trails. Click any trip to view its path on the map.</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={exportToCsv}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-bespoke-card hover:bg-bespoke-surface text-bespoke-gold border border-bespoke-border hover:border-bespoke-gold/40 rounded text-[11px] font-mono uppercase tracking-[0.1em] transition shadow-sm w-fit"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner />
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-bespoke-dim text-xs font-mono uppercase tracking-wider">
            No completed journeys recorded in archive yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bespoke-black/80 text-[10px] text-bespoke-champagne uppercase tracking-[0.12em] border-b border-bespoke-border">
                <tr>
                  <th className="py-3 px-4 font-normal">Vehicle</th>
                  <th className="py-3 px-4 font-normal">Driver</th>
                  <th className="py-3 px-4 font-normal">Origin & Destination</th>
                  <th className="py-3 px-4 font-normal">Date</th>
                  <th className="py-3 px-4 font-normal">Duration</th>
                  <th className="py-3 px-4 font-normal">Total Distance</th>
                  <th className="py-3 px-4 font-normal">Status</th>
                  <th className="py-3 px-4 font-normal text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bespoke-border/60 text-bespoke-champagne">
                {history.map((j) => {
                  const minutes = Math.floor(j.duration_seconds / 60);
                  return (
                    <tr
                      key={j.id}
                      onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                      className="hover:bg-bespoke-card/60 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-medium font-mono text-bespoke-offwhite tracking-wider">
                        {j.vehicle_registration || 'ASSET'}
                      </td>
                      <td className="py-3 px-4 text-bespoke-champagne">{j.driver_name || 'Driver'}</td>
                      <td className="py-3 px-4">
                        <span className="text-bespoke-muted">{j.origin_name}</span>{' '}
                        <span className="text-bespoke-dim">&rarr;</span>{' '}
                        <span className="font-medium text-bespoke-linen">{j.destination_name}</span>
                      </td>
                      <td className="py-3 px-4 text-bespoke-muted font-mono">
                        {new Date(j.started_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 font-mono text-bespoke-champagne">{minutes} mins</td>
                      <td className="py-3 px-4 font-mono font-medium text-bespoke-goldLight" title={`${j.total_distance_km} km`}>
                        {j.total_distance_km != null
                          ? j.total_distance_km < 1
                            ? `${Math.round(j.total_distance_km * 1000)} m`
                            : `${j.total_distance_km.toFixed(2)} km`
                          : '0 m'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={j.status} size="sm" />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/company/live-map?journeyId=${j.id}&replay=true`);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-bespoke-card hover:bg-bespoke-surface text-bespoke-champagne border border-bespoke-border hover:border-bespoke-gold/40 rounded text-[11px] font-mono uppercase tracking-[0.08em] transition shadow-sm cursor-pointer"
                            title="Interactive Route Replay"
                          >
                            <Play className="w-3 h-3 text-bespoke-gold" />
                            <span>Replay</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/company/live-map?journeyId=${j.id}`);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-bespoke-gold hover:bg-bespoke-goldHover text-bespoke-black rounded text-[11px] font-semibold uppercase tracking-[0.08em] transition cursor-pointer"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>View Path</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
