import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Gauge,
  Navigation,
  Clock,
  MapPin,
  Calendar,
  Filter,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { vehiclesApi, positionsApi } from '../../../services/api';
import { Vehicle, Position } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

function ReplayMapFollower({ currentPoint }: { currentPoint: Position | null }) {
  const map = useMap();
  useEffect(() => {
    if (currentPoint) {
      map.panTo([currentPoint.latitude, currentPoint.longitude], { animate: true, duration: 0.3 });
    }
  }, [map, currentPoint]);
  return null;
}

function createReplayMarker(course: number = 0, speed: number = 0) {
  const html = `
    <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(99, 102, 241, 0.35); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; top: -12px; background: #4f46e5; color: white; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 9999px; border: 1.5px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); white-space: nowrap; z-index: 10;">
        ${Math.round(speed)} km/h
      </div>
      <div style="transform: rotate(${course}deg); width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; position: relative; z-index: 5;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="#6366f1" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.5));">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'replay-vehicle-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
  });
}

export const ReplayPage: React.FC = () => {
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
  const [points, setPoints] = useState<Position[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);

  const timerRef = useRef<any>(null);

  useEffect(() => {
    vehiclesApi.list().then((res) => {
      const list = res.items || [];
      setVehicles(list);
      if (list.length > 0 && !selectedVehicleId) {
        setSelectedVehicleId(list[0].id);
      }
    });
  }, []);

  const handleFetchRoute = async () => {
    if (!selectedVehicleId) return;
    try {
      setLoading(true);
      setIsPlaying(false);
      setCurrentIndex(0);

      const fromIso = new Date(fromDate).toISOString();
      const toIso = new Date(toDate).toISOString();

      const res = await positionsApi.list({
        vehicle_id: selectedVehicleId,
        from: fromIso,
        to: toIso,
        limit: 2000,
      });

      const items = res.items || [];
      // Sort chronologically
      items.sort((a, b) => new Date(a.device_time).getTime() - new Date(b.device_time).getTime());
      setPoints(items);
    } catch (e: any) {
      alert('Failed to load route points: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
    }
  };

  // Playback timer
  useEffect(() => {
    if (isPlaying && points.length > 0) {
      const intervalMs = Math.max(100, Math.round(1000 / speedMultiplier));
      timerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= points.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, points.length, speedMultiplier]);

  const currentPoint = points[currentIndex] || null;

  const polylineCoords = useMemo(
    () => points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [points]
  );

  const traveledCoords = useMemo(
    () => points.slice(0, currentIndex + 1).map((p) => [p.latitude, p.longitude] as [number, number]),
    [points, currentIndex]
  );

  const mapCenter: [number, number] = useMemo(() => {
    if (currentPoint) return [currentPoint.latitude, currentPoint.longitude];
    if (points.length > 0) return [points[0].latitude, points[0].longitude];
    return [12.9716, 77.5946];
  }, [currentPoint, points]);

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-indigo-400" />
            Route Playback & Historic Replay
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Step through historical trips with interactive timeline scrubbing and speed telemetry
          </p>
        </div>
      </div>

      {/* Query Filter Toolbar */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 font-semibold mb-1">Target Vehicle</label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select a vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration_number} ({v.model})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">From</label>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">To</label>
            <input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="primary"
              size="md"
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              onClick={handleFetchRoute}
              disabled={loading || !selectedVehicleId}
            >
              <Filter className="w-4 h-4" />
              <span>{loading ? 'Retrieving Trace...' : 'Load Route Trace'}</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Replay Controls & Map */}
      <div className="space-y-4">
        {/* Scrubber & Playback Controls Bar */}
        <Card>
          <div className="space-y-3">
            {/* Timeline slider */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-400 w-16 text-right">
                {currentPoint ? new Date(currentPoint.device_time).toLocaleTimeString() : '00:00:00'}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, points.length - 1)}
                value={currentIndex}
                onChange={(e) => {
                  setCurrentIndex(parseInt(e.target.value, 10));
                  setIsPlaying(false);
                }}
                disabled={points.length === 0}
                className="flex-1 accent-indigo-500 cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-400 w-16">
                {currentIndex + 1} / {points.length} pts
              </span>
            </div>

            {/* Play/Pause & Speed Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => setIsPlaying(!isPlaying)}
                  disabled={points.length === 0}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCurrentIndex(0);
                    setIsPlaying(false);
                  }}
                  disabled={points.length === 0}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restart</span>
                </Button>
              </div>

              {/* Speed Multiplier 1x, 2x, 4x, 8x */}
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                {[1, 2, 4, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeedMultiplier(s)}
                    className={`px-2.5 py-1 rounded-lg font-bold font-mono text-[11px] transition ${
                      speedMultiplier === s
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              {/* HUD Telemetry Chips */}
              <div className="flex items-center gap-3 text-xs font-mono">
                <div className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-slate-400">Speed:</span>
                  <strong className="text-white">{Math.round(currentPoint?.speed || 0)} km/h</strong>
                </div>
                <div className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-slate-400">Heading:</span>
                  <strong className="text-white">{Math.round(currentPoint?.course || 0)}°</strong>
                </div>
                <div className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-1.5">
                  <span className="text-slate-400">Odo:</span>
                  <strong className="text-emerald-400">
                    {((currentPoint?.total_distance_m || 0) / 1000).toFixed(2)} km
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Map */}
        <div className="h-[520px] w-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative">
          {points.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500 text-xs">
              <RotateCcw className="w-8 h-8 mb-2 opacity-50" />
              <span>Select a device and click &quot;Load Route Trace&quot; to begin playback</span>
            </div>
          ) : (
            <MapContainer center={mapCenter} zoom={14} className="w-full h-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="dark-tiles"
              />

              <ReplayMapFollower currentPoint={currentPoint} />

              {/* Full route planned/historical path in dim grey */}
              {polylineCoords.length > 1 && (
                <Polyline
                  positions={polylineCoords}
                  pathOptions={{
                    color: '#475569',
                    weight: 3,
                    opacity: 0.5,
                    dashArray: '6, 6',
                  }}
                />
              )}

              {/* Traveled route path in vibrant indigo */}
              {traveledCoords.length > 1 && (
                <Polyline
                  positions={traveledCoords}
                  pathOptions={{
                    color: '#6366f1',
                    weight: 4,
                    opacity: 0.9,
                    lineCap: 'round',
                  }}
                />
              )}

              {/* Moving Replay Vehicle Marker */}
              {currentPoint && (
                <Marker
                  position={[currentPoint.latitude, currentPoint.longitude]}
                  icon={createReplayMarker(currentPoint.course, currentPoint.speed)}
                >
                  <Popup className="custom-leaflet-popup">
                    <div className="p-1 min-w-[180px] text-slate-900 text-xs">
                      <span className="text-[10px] font-bold text-indigo-700 uppercase block">Trip Replay Fix</span>
                      <p className="font-bold font-mono text-sm">{Math.round(currentPoint.speed)} km/h</p>
                      <p className="text-[10px] text-slate-600 font-mono">
                        {currentPoint.latitude.toFixed(5)}, {currentPoint.longitude.toFixed(5)}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {new Date(currentPoint.device_time).toLocaleString()}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          )}
        </div>
      </div>
    </div>
  );
};
