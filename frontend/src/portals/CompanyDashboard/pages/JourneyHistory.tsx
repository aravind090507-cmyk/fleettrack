import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Calendar, CheckCircle, MapPin, ArrowRight, Download, Play } from 'lucide-react';
import { journeysApi } from '../../../services/api';
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

  useEffect(() => {
    loadHistory(true);
    const interval = setInterval(() => loadHistory(false), 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Trip Archives & Historical Records</h2>
          <p className="text-xs text-slate-400">Completed journey records, duration metrics, and distance audit trails. Click any trip to view its path on the map.</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={exportToCsv}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition shadow-sm w-fit"
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
          <div className="text-center py-12 text-slate-500 text-xs">
            No completed journeys recorded in archive yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
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
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {history.map((j) => {
                  const minutes = Math.floor(j.duration_seconds / 60);
                  return (
                    <tr
                      key={j.id}
                      onClick={() => navigate(`/company/live-map?journeyId=${j.id}`)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold font-mono text-white">
                        {j.vehicle_registration || 'ASSET'}
                      </td>
                      <td className="py-3 px-4">{j.driver_name || 'Driver'}</td>
                      <td className="py-3 px-4">
                        <span className="text-slate-400">{j.origin_name}</span> →{' '}
                        <span className="font-semibold text-white">{j.destination_name}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(j.started_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 font-mono">{minutes} mins</td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                        {j.total_distance_km} km
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={j.status} size="sm" />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/company/live-map?journeyId=${j.id}&replay=true`);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-[11px] font-bold transition shadow-sm cursor-pointer"
                            title="Interactive Route Replay"
                          >
                            <Play className="w-3 h-3 text-indigo-400" />
                            <span>Replay</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/company/live-map?journeyId=${j.id}`);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold transition cursor-pointer"
                          >
                            <MapPin className="w-3 h-3 text-emerald-400" />
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
