import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Play,
  Pause,
  Square,
  FastForward,
  Clock,
  Gauge,
  Navigation,
  Calendar,
  Filter,
  CheckCircle,
} from 'lucide-react';
import { useVehicles } from '../hooks/useVehicles';
import { locationService } from '../services/locationService';
import { FleetMap } from '../components/map/FleetMap';
import { Vehicle, RouteHistoryPoint, RouteStats } from '../types';
import { formatSpeed, formatDuration, formatVehicleType } from '../utils/formatters';

export function RouteHistoryPage() {
  const [searchParams] = useSearchParams();
  const initialVehicleId = searchParams.get('vehicleId');

  const { vehicles } = useVehicles();
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    initialVehicleId || (vehicles[0]?.id || '')
  );

  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [historyPoints, setHistoryPoints] = useState<RouteHistoryPoint[]>([]);
  const [stats, setStats] = useState<RouteStats | null>(null);

  // Playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 5 | 10>(1);
  const playbackTimerRef = useRef<any>(null);

  useEffect(() => {
    if (initialVehicleId && vehicles.some((v: Vehicle) => v.id === initialVehicleId)) {
      setSelectedVehicleId(initialVehicleId);
    } else if (!selectedVehicleId && vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, initialVehicleId]);

  const loadHistory = async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    setIsPlaying(false);
    setPlaybackIndex(0);

    try {
      const start = `${date}T00:00:00Z`;
      const end = `${date}T23:59:59Z`;
      const res = await locationService.getHistory(selectedVehicleId, {
        start_time: start,
        end_time: end,
        limit: 1000,
      });

      const pts: RouteHistoryPoint[] = res.locations || [];
      setHistoryPoints(pts);

      // Compute stats
      if (pts.length > 0) {
        let maxSpd = 0;
        let sumSpd = 0;
        let stops = 0;

        pts.forEach((p) => {
          if (p.speed > maxSpd) maxSpd = p.speed;
          sumSpd += p.speed;
          if (p.speed < 1.0) stops += 1;
        });

        // Compute straight path distance
        let totalDist = 0;
        for (let i = 1; i < pts.length; i++) {
          const lat1 = pts[i - 1].latitude;
          const lon1 = pts[i - 1].longitude;
          const lat2 = pts[i].latitude;
          const lon2 = pts[i].longitude;
          const R = 6371; // km
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLon = ((lon2 - lon1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          totalDist += R * c;
        }

        const tStart = new Date(pts[0].recorded_at).getTime();
        const tEnd = new Date(pts[pts.length - 1].recorded_at).getTime();
        const durSec = Math.max(60, Math.round((tEnd - tStart) / 1000));

        setStats({
          duration_seconds: durSec,
          total_distance_km: round2(totalDist),
          max_speed: round2(maxSpd),
          avg_speed: round2(sumSpd / pts.length),
          stops_count: stops,
        });
      } else {
        setStats(null);
      }
    } catch (err) {
      console.error('Failed to load vehicle route history:', err);
      setHistoryPoints([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const round2 = (num: number) => Math.round(num * 100) / 100;

  // Auto-load when vehicle or date changes
  useEffect(() => {
    if (selectedVehicleId) {
      loadHistory();
    }
  }, [selectedVehicleId, date]);

  // Playback timer ticker
  useEffect(() => {
    if (isPlaying && historyPoints.length > 0) {
      const intervalMs = Math.max(100, 1000 / playbackSpeed);
      playbackTimerRef.current = setTimeout(() => {
        setPlaybackIndex((prev) => {
          if (prev >= historyPoints.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    };
  }, [isPlaying, playbackIndex, playbackSpeed, historyPoints]);

  const currentPoint = historyPoints[playbackIndex];

  // Prepare polyline array [lat, lng]
  const polylineCoords: [number, number][] = historyPoints.map((p) => [p.latitude, p.longitude]);

  // Virtual playback vehicle location map
  const playbackVehicle = vehicles.find((v: Vehicle) => v.id === selectedVehicleId);
  const playbackLocation = currentPoint && playbackVehicle
    ? {
        [playbackVehicle.id]: {
          vehicle_id: playbackVehicle.id,
          latitude: currentPoint.latitude,
          longitude: currentPoint.longitude,
          speed: currentPoint.speed,
          heading: currentPoint.heading,
          recorded_at: currentPoint.recorded_at,
          is_simulated: true,
        },
      }
    : {};

  return (
    <div className="space-y-4">
      {/* Header & Filter Controls */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Historical Route Replay</h1>
          <p className="text-xs text-slate-400">
            Inspect historical vehicle trajectories, analyze speeds, and replay field journeys.
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Vehicle dropdown */}
          <select
            value={selectedVehicleId}
            onChange={(e) => setSelectedVehicleId(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
          >
            {vehicles.map((v: Vehicle) => (
              <option key={v.id} value={v.id}>
                {v.registration_number} ({formatVehicleType(v.vehicle_type)})
              </option>
            ))}
          </select>

          {/* Date Picker */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={loadHistory}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Route'}
          </button>
        </div>
      </div>

      {/* Main Area: Map + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Map Container (9 Cols) */}
        <div className="lg:col-span-9 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="h-[480px] w-full">
            <FleetMap
              vehicles={playbackVehicle ? [playbackVehicle] : []}
              locations={playbackLocation}
              selectedVehicleIds={selectedVehicleId ? [selectedVehicleId] : []}
              showRoute={
                polylineCoords.length > 0
                  ? { vehicleId: selectedVehicleId, coordinates: polylineCoords }
                  : null
              }
              height="100%"
            />
          </div>

          {/* Route Playback Toolbar */}
          {historyPoints.length > 0 && (
            <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-3">
              {/* Timeline Scrubber */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-400 min-w-[70px]">
                  {currentPoint ? new Date(currentPoint.recorded_at).toLocaleTimeString() : '--'}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, historyPoints.length - 1)}
                  value={playbackIndex}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setPlaybackIndex(Number(e.target.value));
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <span className="text-[11px] font-mono text-slate-400">
                  {playbackIndex + 1} / {historyPoints.length} pts
                </span>
              </div>

              {/* Playback Button Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isPlaying ? 'Pause' : 'Play'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(0);
                    }}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                    title="Stop & Reset"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Playback Speeds */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold mr-1">
                    Speed:
                  </span>
                  {[1, 2, 5, 10].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd as any)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors ${
                        playbackSpeed === spd
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats Column (3 Cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Journey Summary
            </h3>

            {stats ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Distance</span>
                  <div className="text-lg font-bold text-white font-mono">{stats.total_distance_km} km</div>
                </div>

                <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Duration</span>
                  <div className="text-lg font-bold text-emerald-400 font-mono">
                    {formatDuration(stats.duration_seconds)}
                  </div>
                </div>

                <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Maximum Speed</span>
                  <div className="text-lg font-bold text-white font-mono">{stats.max_speed} km/h</div>
                </div>

                <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Average Speed</span>
                  <div className="text-lg font-bold text-white font-mono">{stats.avg_speed} km/h</div>
                </div>

                <div className="p-3 bg-slate-800/60 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Recorded Stops</span>
                  <div className="text-lg font-bold text-amber-400 font-mono">{stats.stops_count} stops</div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                {loading ? 'Retrieving coordinates...' : 'No historical route telemetry recorded for this vehicle & date.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export default RouteHistoryPage;
