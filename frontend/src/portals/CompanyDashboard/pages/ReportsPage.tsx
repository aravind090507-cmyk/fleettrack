import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Filter,
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
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#0071E3]" />
            Telematics & Trip Reports
          </h2>
          <p className="text-xs text-zinc-600 mt-0.5 font-medium">
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
            <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">Target Vehicle</label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
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
            <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">From Timestamp</label>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">To Timestamp</label>
            <input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
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

      {/* Segmented Control Tabs */}
      <div className="flex p-1.5 bg-black/[0.04] rounded-2xl border border-black/5 gap-1 w-fit">
        {(['trips', 'stops', 'summary', 'route', 'events'] as ReportTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition cursor-pointer ${
              tab === t
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
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
                <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
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
                <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                  {tripsData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-600 font-semibold">
                        No trips found for the selected time window.
                      </td>
                    </tr>
                  ) : (
                    tripsData.map((trip, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(trip.start_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(trip.end_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-zinc-900">
                          {Math.floor(trip.duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 font-bold text-blue-600 font-mono">
                          {trip.distance_km.toFixed(2)} km
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-900 font-semibold">{Math.round(trip.max_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 font-mono text-zinc-800">{Math.round(trip.avg_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 text-zinc-700 font-medium text-xs truncate max-w-xs">
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
                <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
                  <tr>
                    <th className="py-3 px-4">Stop Start</th>
                    <th className="py-3 px-4">Stop End</th>
                    <th className="py-3 px-4">Idle Duration</th>
                    <th className="py-3 px-4">Coordinates</th>
                    <th className="py-3 px-4">Address / Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                  {stopsData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-600 font-semibold">
                        No idle stops (&ge; 30s) detected for this window.
                      </td>
                    </tr>
                  ) : (
                    stopsData.map((stop, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(stop.start_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(stop.end_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-bold text-amber-700 font-mono">
                          {Math.floor(stop.duration_seconds / 60)}m {stop.duration_seconds % 60}s
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-700 font-medium">
                          {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-zinc-800 font-medium text-xs">{stop.address || 'Stationary Stop'}</td>
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
                <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
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
                <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                  {summaryData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-600 font-semibold">
                        No summary metrics recorded.
                      </td>
                    </tr>
                  ) : (
                    summaryData.map((s, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-zinc-900">{s.device_name}</td>
                        <td className="py-3 px-4 font-bold text-blue-600 font-mono">
                          {s.distance_km.toFixed(2)} km
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-zinc-900">{Math.round(s.max_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 font-mono text-zinc-800">{Math.round(s.avg_speed_kmh)} km/h</td>
                        <td className="py-3 px-4 text-zinc-800 font-mono font-medium">
                          {Math.floor(s.moving_duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 text-zinc-700 font-mono font-medium">
                          {Math.floor(s.stop_duration_seconds / 60)} min
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-zinc-900">{s.position_count}</td>
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
                <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Coordinates</th>
                    <th className="py-3 px-4">Speed</th>
                    <th className="py-3 px-4">Course</th>
                    <th className="py-3 px-4">Odometer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                  {routeData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-zinc-600 font-semibold">
                        No route positions retrieved.
                      </td>
                    </tr>
                  ) : (
                    routeData.slice(0, 100).map((pt, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(pt.device_time).toLocaleString()}</td>
                        <td className="py-3 px-4 font-mono text-zinc-700 font-medium">
                          {pt.latitude.toFixed(5)}, {pt.longitude.toFixed(5)}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-zinc-900">{Math.round(pt.speed)} km/h</td>
                        <td className="py-3 px-4 font-mono text-zinc-800">{Math.round(pt.course)}°</td>
                        <td className="py-3 px-4 font-mono font-bold text-blue-600">
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
                <thead className="bg-zinc-50/90 text-zinc-700 uppercase text-[10px] font-bold tracking-wider border-b border-black/[0.06]">
                  <tr>
                    <th className="py-3 px-4">Event Time</th>
                    <th className="py-3 px-4">Event Type</th>
                    <th className="py-3 px-4">Device ID</th>
                    <th className="py-3 px-4">Attributes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] text-zinc-800">
                  {eventsData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-zinc-600 font-semibold">
                        No events logged for this window.
                      </td>
                    </tr>
                  ) : (
                    eventsData.map((ev, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-zinc-800">{new Date(ev.event_time).toLocaleString()}</td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-[#0071E3] border border-blue-200">
                            {ev.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-zinc-800">{ev.device_id}</td>
                        <td className="py-3 px-4 font-mono text-zinc-700 text-xs font-medium">
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
