import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Calendar, CheckCircle, MapPin, ArrowRight } from 'lucide-react';
import { journeysApi } from '../../../services/api';
import { Journey } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

export const JourneyHistory: React.FC = () => {
  const [history, setHistory] = useState<Journey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    journeysApi
      .getHistory(0, 50)
      .then((data) => setHistory(data))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Trip Archives & Historical Records</h2>
        <p className="text-xs text-slate-400">Completed journey records, duration metrics, and distance audit trails. Click any trip to view its path on the map.</p>
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/company/live-map?journeyId=${j.id}`);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold transition"
                        >
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          <span>View Path</span>
                        </button>
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
