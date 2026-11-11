import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Calendar,
  Filter,
  Route as RouteIcon,
  Navigation,
  Clock,
  Gauge,
  MapPin,
  AlertTriangle,
} from 'lucide-react';
import { reportsApi, vehiclesApi, eventsApi } from '../../../services/api';
import { Vehicle, Position, StopReportItem, SummaryReportItem, TelematicsEvent, TripReportItem } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

type ReportTab = 'trips' | 'stops' | 'summary' | 'route' | 'events';

export const ReportsPage: React.FC = () => {
  const [tab, setTab] = useState<ReportTab>('trips');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');

  // Default to today
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState<string>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 16);
  });

  const [loading, setLoading] = useState<boolean>(false);

  // Data states
  const [tripsData, setTripsData] = useState<TripReportItem[]>([]);
  const [stopsData, setStopsData] = useState<StopReportItem[]>([]);
  const [summaryData, setSummaryData] = useState<SummaryReportItem[]>([]);
  const [routeData, setRouteData] = useState<Position[]>([]);
  const [eventsData, setEventsData] = useState<TelematicsEvent[]>([]);

  useEffect(() => {
    vehiclesApi.list().then((res) => {
      const list = res.items || [];
      setVehicles(list);
      if (list.length > 0 && !selectedVehicleId) {
        setSelectedVehicleId(list[0].id);
      }
    });
  }, []);

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      const fromIso = new Date(fromDate).toISOString();
      const toIso = new Date(toDate).toISOString();
      const vId = selectedVehicleId || undefined;

      if (tab === 'trips') {
        const data = await reportsApi.getTrips({ vehicle_id: vId, from: fromIso, to: toIso });
        setTripsData(Array.isArray(data) ? data : []);
      } else if (tab === 'stops') {
        const data = await reportsApi.getStops({ vehicle_id: vId, from: fromIso, to: toIso });
        setStopsData(Array.isArray(data) ? data : []);
      } else if (tab === 'summary') {
        const data = await reportsApi.getSummary({ vehicle_id: vId, from: fromIso, to: toIso });
        setSummaryData(Array.isArray(data) ? data : []);
      } else if (tab === 'route') {
        const data = await reportsApi.getRoute({ vehicle_id: vId, from: fromIso, to: toIso });
        setRouteData(Array.isArray(data) ? data : []);
      } else if (tab === 'events') {
        const data = await eventsApi.list({ vehicle_id: vId, from: fromIso, to: toIso, limit: 100 });
        setEventsData(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      alert('Failed to generate report: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = async () => {
    const fromIso = new Date(fromDate).toISOString();
    const toIso = new Date(toDate).toISOString();
    const vId = selectedVehicleId || undefined;

    try {
      let blob: any = null;
      let filename = `fleettrack_${tab}_report.csv`;

      if (tab === 'trips') {
        blob = await reportsApi.getTrips({ vehicle_id: vId, from: fromIso, to: toIso, format: 'csv' });
      } else if (tab === 'stops') {
        blob = await reportsApi.getStops({ vehicle_id: vId, from: fromIso, to: toIso, format: 'csv' });
      } else if (tab === 'route') {
        blob = await reportsApi.getRoute({ vehicle_id: vId, from: fromIso, to: toIso, format: 'csv' });
      } else {
        alert('CSV export available for Trips, Stops, and Route reports.');
        return;
      }

      if (blob) {
        const url = window.URL.createObjectURL(new Blob([blob]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
      }
    } catch (e: any) {
      alert('Export failed: ' + e.message);
    }
  };

  const handleExportGpx = async () => {
    if (tab !== 'route') {
      alert('GPX export is only available for Route traces.');
      return;
    }
    const fromIso = new Date(fromDate).toISOString();
    const toIso = new Date(toDate).toISOString();
    const vId = selectedVehicleId || undefined;

    try {
      const blob = await reportsApi.getRoute({ vehicle_id: vId, from: fromIso, to: toIso, format: 'gpx' });
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/gpx+xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'fleettrack_route.gpx');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (e: any) {
      alert('GPX export failed: ' + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            Telematics & Trip Reports
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Historical trip segmentation, idle stops, operational summaries, and route exports
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(tab === 'trips' || tab === 'stops' || tab === 'route') && (
            <Button variant="secondary" size="sm" onClick={handleExportCsv}>
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </Button>
          )}
          {tab === 'route' && (
            <Button variant="secondary" size="sm" onClick={handleExportGpx}>
              <Download className="w-3.5 h-3.5" />
              <span>Export GPX</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Target Vehicle</label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">All Fleet Vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration_number} ({v.model})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">From Timestamp</label>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">To Timestamp</label>
            <input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-end">
            <Button variant="primary" size="md" className="w-full" onClick={handleGenerateReport} disabled={loading}>
              <Filter className="w-4 h-4" />
              <span>{loading ? 'Compiling...' : 'Generate Report'}</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 space-x-1">
        {(['trips', 'stops', 'summary', 'route', 'events'] as ReportTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition ${
              tab === t
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Report Content Table */}
      {loading ? (
        <LoadingSpinner label="Compiling report metrics..." />
      ) : (
        <Card>
          {tab === 'trips' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Start Time</th>
                    <th className="py-3 px-4">End Time</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Distance (km)</th>
                    <th className="py-3 px-4">Max Speed</th>
                    <th className="py-3 px-4">Avg Speed</th>
                    <th className="py-3 px-4">Endpoints</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {tripsData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No trips found for the selected time window.
                      </td>
                    </tr>
                  ) : (
                    tripsData.map((trip, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono">{new Date(trip.start_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono">{new Date(trip.end_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-semibold text-white">
                          {Math.floor(trip.duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-400 font-mono">
                          {trip.distance_km.toFixed(2)} km
                        </td>
                        <td className="py-3 px-4 font-mono">{Math.round(trip.max_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 font-mono">{Math.round(trip.avg_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 text-slate-400 text-[11px] truncate max-w-xs">
                          {trip.start_lat.toFixed(4)}, {trip.start_lng.toFixed(4)} &rarr; {trip.end_lat.toFixed(4)},{' '}
                          {trip.end_lng.toFixed(4)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'stops' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Stop Start</th>
                    <th className="py-3 px-4">Stop End</th>
                    <th className="py-3 px-4">Idle Duration</th>
                    <th className="py-3 px-4">Coordinates</th>
                    <th className="py-3 px-4">Address / Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {stopsData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No idle stops (&ge; 30s) detected for this window.
                      </td>
                    </tr>
                  ) : (
                    stopsData.map((stop, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono">{new Date(stop.start_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono">{new Date(stop.end_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-amber-400 font-mono">
                          {Math.floor(stop.duration_seconds / 60)}m {stop.duration_seconds % 60}s
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-[11px]">{stop.address || 'Stationary Stop'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'summary' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Device</th>
                    <th className="py-3 px-4">Distance</th>
                    <th className="py-3 px-4">Max Speed</th>
                    <th className="py-3 px-4">Avg Speed</th>
                    <th className="py-3 px-4">Moving Time</th>
                    <th className="py-3 px-4">Stop Time</th>
                    <th className="py-3 px-4">GPS Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {summaryData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No summary metrics recorded.
                      </td>
                    </tr>
                  ) : (
                    summaryData.map((s, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-bold text-white">{s.device_name}</td>
                        <td className="py-3 px-4 font-bold text-emerald-400 font-mono">
                          {s.distance_km.toFixed(2)} km
                        </td>
                        <td className="py-3 px-4 font-mono">{Math.round(s.max_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 font-mono">{Math.round(s.avg_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 text-slate-300 font-mono">
                          {Math.floor(s.moving_duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono">
                          {Math.floor(s.stop_duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 font-mono">{s.position_count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'route' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Coordinates</th>
                    <th className="py-3 px-4">Speed</th>
                    <th className="py-3 px-4">Course</th>
                    <th className="py-3 px-4">Odometer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {routeData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No route positions retrieved.
                      </td>
                    </tr>
                  ) : (
                    routeData.slice(0, 100).map((pt, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono">{new Date(pt.device_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {pt.latitude.toFixed(5)}, {pt.longitude.toFixed(5)}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-white">{Math.round(pt.speed)} km/h</td>
                        <td className="py-3 px-4 font-mono">{Math.round(pt.course)}°</td>
                        <td className="py-3 px-4 font-mono text-emerald-400">
                          {(pt.total_distance_m / 1000).toFixed(2)} km
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'events' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Event Time</th>
                    <th className="py-3 px-4">Event Type</th>
                    <th className="py-3 px-4">Device ID</th>
                    <th className="py-3 px-4">Attributes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {eventsData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        No events logged for this window.
                      </td>
                    </tr>
                  ) : (
                    eventsData.map((ev, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono">{new Date(ev.event_time).toLocaleString()}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800">
                            {ev.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">{ev.device_id}</td>
                        <td className="py-3 px-4 font-mono text-slate-500 text-[10px]">
                          {JSON.stringify(ev.attributes || {})}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
