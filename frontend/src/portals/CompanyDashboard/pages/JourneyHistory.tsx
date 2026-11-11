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
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <History className="w-5 h-5 text-[#0071E3]" />
            Trip Archives & Historical Records
          </h2>
          <p className="text-xs text-zinc-600 mt-0.5">
            Completed journey records, duration metrics, and distance audit trails. Click any trip to view its path on the map.
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={exportToCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-zinc-50 text-zinc-800 border border-black/10 rounded-full text-xs font-semibold transition shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-zinc-700" />
            <span>Export CSV</span>
          </button>
        )}
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner />
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-zinc-600 text-xs font-semibold uppercase tracking-wider">
            No completed journeys recorded in archive yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
                <tr>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4">Driver</th>
                  <th className="py-3 px-4">Origin & Destination</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Total Distance</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                {history.map((j) => {
                  const minutes = Math.floor(j.duration_seconds / 60);
                  return (
                    <tr
                      key={j.id}
                      onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold font-mono text-zinc-900 tracking-tight">
                        {j.vehicle_registration || 'ASSET'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-zinc-800">{j.driver_name || 'Driver'}</td>
                      <td className="py-3 px-4">
                        <span className="text-zinc-800 font-semibold">{j.origin_name}</span>{' '}
                        <span className="text-zinc-500 font-bold mx-1">&rarr;</span>{' '}
                        <span className="text-zinc-800 font-semibold">{j.destination_name}</span>
                      </td>
                      <td className="py-3 px-4 text-zinc-700 font-mono text-xs">
                        {new Date(j.started_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-900 font-semibold">{minutes} mins</td>
                      <td className="py-3 px-4 font-mono font-bold text-blue-600" title={`${j.total_distance_km} km`}>
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
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-full text-xs font-semibold transition shadow-sm cursor-pointer border border-zinc-200/80"
                            title="Interactive Route Replay"
                          >
                            <Play className="w-3 h-3 text-[#0071E3]" />
                            <span>Replay</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/company/live-map?journeyId=${j.id}`);
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0071E3] hover:bg-blue-600 text-white rounded-full text-xs font-semibold shadow-sm shadow-blue-500/20 transition cursor-pointer"
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
