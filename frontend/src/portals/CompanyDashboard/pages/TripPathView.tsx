import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Navigation,
  MapPin,
  Clock,
  Car,
  User,
  Activity,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Layers,
  Crosshair,
  Gauge,
  CheckCircle2,
  Flag,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { journeysApi, locationApi } from '../../../services/api';
import { Journey, WebSocketMessage } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { getMapTileConfig } from '../../../services/mapConfig';
import { haversineMeters } from '../../../services/adaptiveTracking';
import { useWebSocket } from '../../../hooks/useWebSocket';

export interface JourneyBreadcrumbPoint {
  id?: string | number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  altitude?: number | null;
  accuracy: number;
  recorded_at: string;
}

// Distinct green START marker
const startIcon = L.divIcon({
  html: `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
      <div style="background: #10b981; color: white; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; box-shadow: 0 2px 8px rgba(16,185,129,0.5); border: 1.5px solid white; white-space: nowrap; margin-bottom: 3px; letter-spacing: 0.5px;">
        START
      </div>
      <div style="width: 26px; height: 26px; background: #10b981; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.35);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
        </svg>
      </div>
    </div>
  `,
  className: 'trip-start-pin',
  iconSize: [54, 50],
  iconAnchor: [27, 50],
  popupAnchor: [0, -48],
});

// Distinct red DESTINATION marker
const destinationIcon = L.divIcon({
  html: `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
      <div style="background: #ef4444; color: white; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; box-shadow: 0 2px 8px rgba(239,68,68,0.5); border: 1.5px solid white; white-space: nowrap; margin-bottom: 3px; letter-spacing: 0.5px;">
        DESTINATION
      </div>
      <div style="width: 26px; height: 26px; background: #ef4444; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.35);">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none">
          <polygon points="3 2 19 9 3 16 3 2"/>
        </svg>
      </div>
    </div>
  `,
  className: 'trip-destination-pin',
  iconSize: [90, 50],
  iconAnchor: [45, 50],
  popupAnchor: [0, -48],
});

// Distinct moving vehicle icon with orientation and speed badge
function createLiveVehicleIcon(heading: number = 0, speed: number = 0) {
  const safeHeading = isFinite(heading) ? heading : 0;
  const html = `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(0, 113, 227, 0.35); animation: ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; top: -14px; background: #0071e3; color: white; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 9999px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35); white-space: nowrap; z-index: 10;">
        ${Math.round(speed)} km/h
      </div>
      <div style="transform: rotate(${safeHeading}deg); width: 34px; height: 34px; border-radius: 50%; background: #0071e3; border: 3px solid #ffffff; box-shadow: 0 6px 14px rgba(0,113,227,0.5); display: flex; align-items: center; justify-content: center; position: relative; z-index: 5;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" stroke="none">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'trip-live-vehicle-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -22],
  });
}

// Map bounds controller to auto-fit full travelled path
function TripBoundsController({
  points,
  startCoord,
  destCoord,
  triggerFit,
}: {
  points: [number, number][];
  startCoord?: [number, number] | null;
  destCoord?: [number, number] | null;
  triggerFit: number;
}) {
  const map = useMap();

  useEffect(() => {
    const allCoords: [number, number][] = [];
    if (startCoord && !isNaN(startCoord[0]) && !isNaN(startCoord[1])) {
      allCoords.push(startCoord);
    }
    if (destCoord && !isNaN(destCoord[0]) && !isNaN(destCoord[1])) {
      allCoords.push(destCoord);
    }
    if (points && points.length > 0) {
      for (const p of points) {
        if (!isNaN(p[0]) && !isNaN(p[1])) {
          allCoords.push(p);
        }
      }
    }

    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords);
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });
    }
  }, [map, points, startCoord, destCoord, triggerFit]);

  return null;
}

export const TripPathView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const journeyId = searchParams.get('journeyId') || '';
  const fromSource = searchParams.get('from') || 'history'; // 'history' | 'active'

  const [journey, setJourney] = useState<Journey | null>(null);
  const [gpsPoints, setGpsPoints] = useState<JourneyBreadcrumbPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<'apple' | 'dark'>('apple');
  const [triggerFit, setTriggerFit] = useState<number>(0);
  const [latestLivePing, setLatestLivePing] = useState<JourneyBreadcrumbPoint | null>(null);

  // Load journey details and historical GPS coordinates
  const loadTripData = useCallback(async () => {
    if (!journeyId) {
      setError('No journey ID provided.');
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      const [jData, historyData] = await Promise.all([
        journeysApi.get(journeyId),
        locationApi.getHistory(journeyId).catch(() => []),
      ]);

      setJourney(jData);

      // Filter and sort verified GPS coordinates by recorded_at ascending
      const validPoints: JourneyBreadcrumbPoint[] = (historyData || [])
        .filter((p: any) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number' && !isNaN(p.latitude) && !isNaN(p.longitude))
        .map((p: any) => ({
          id: p.id || Math.random().toString(),
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed ?? 0,
          heading: p.heading ?? p.course ?? 0,
          altitude: p.altitude ?? 0,
          accuracy: p.accuracy ?? 10,
          recorded_at: p.recorded_at || p.timestamp || p.fix_time || new Date().toISOString(),
        }))
        .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

      setGpsPoints(validPoints);
      if (validPoints.length > 0) {
        setLatestLivePing(validPoints[validPoints.length - 1]);
      }
      setError(null);
    } catch (err: any) {
      console.error('Failed to load trip path data:', err);
      setError(err?.response?.data?.detail || 'Unable to retrieve journey details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [journeyId]);

  useEffect(() => {
    loadTripData();
  }, [loadTripData]);

  // Is this journey currently active / live?
  const isLive = useMemo(() => {
    return journey?.status === 'IN_PROGRESS';
  }, [journey?.status]);

  // Handle incoming live WebSocket telemetry
  const handleWebSocketMessage = useCallback((msg: WebSocketMessage) => {
    if (!isLive || !journey) return;

    if (msg.type === 'LOCATION_UPDATE' || msg.type === 'DRIVER_LOCATION' || msg.type === 'POSITION_UPDATE') {
      const ping = msg.payload || msg.data;
      if (!ping) return;

      const matchesJourney = ping.journey_id === journey.id || (!ping.journey_id && ping.vehicle_id === journey.vehicle_id);
      if (matchesJourney && typeof ping.latitude === 'number' && typeof ping.longitude === 'number') {
        const newPoint: JourneyBreadcrumbPoint = {
          id: ping.id || Math.random().toString(),
          latitude: ping.latitude,
          longitude: ping.longitude,
          speed: ping.speed ?? 0,
          heading: ping.heading ?? ping.course ?? 0,
          altitude: ping.altitude ?? 0,
          accuracy: ping.accuracy ?? 10,
          recorded_at: ping.recorded_at || ping.timestamp || new Date().toISOString(),
        };

        setGpsPoints((prev) => {
          // Avoid duplicate timestamps
          if (prev.length > 0 && prev[prev.length - 1].recorded_at === newPoint.recorded_at) {
            return prev;
          }
          return [...prev, newPoint];
        });
        setLatestLivePing(newPoint);
      }
    } else if (msg.type === 'JOURNEY_COMPLETED' && msg.payload?.journey_id === journey.id) {
      loadTripData();
    }
  }, [isLive, journey, loadTripData]);

  const { isConnected: wsConnected } = useWebSocket({
    url: isLive ? '/ws/live-fleet' : '',
    onMessage: handleWebSocketMessage,
  });

  // Fallback polling for live journeys when WebSocket is inactive
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      locationApi.getHistory(journeyId).then((history) => {
        if (history && history.length > gpsPoints.length) {
          const valid: JourneyBreadcrumbPoint[] = history
            .filter((p: any) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')
            .map((p: any) => ({
              id: p.id || Math.random().toString(),
              latitude: p.latitude,
              longitude: p.longitude,
              speed: p.speed ?? 0,
              heading: p.heading ?? p.course ?? 0,
              altitude: p.altitude ?? 0,
              accuracy: p.accuracy ?? 10,
              recorded_at: p.recorded_at || p.timestamp || p.fix_time || new Date().toISOString(),
            }))
            .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
          setGpsPoints(valid);
          if (valid.length > 0) {
            setLatestLivePing(valid[valid.length - 1]);
          }
        }
      }).catch(() => {});
    }, wsConnected ? 20000 : 7000);

    return () => clearInterval(interval);
  }, [isLive, journeyId, wsConnected, gpsPoints.length]);

  // Calculated distance directly from recorded GPS coordinates
  const calculatedDistanceKm = useMemo(() => {
    if (journey?.total_distance_km && journey.total_distance_km > 0) {
      return journey.total_distance_km;
    }
    if (gpsPoints.length < 2) return 0;
    let totalMeters = 0;
    for (let i = 1; i < gpsPoints.length; i++) {
      totalMeters += haversineMeters(
        gpsPoints[i - 1].latitude,
        gpsPoints[i - 1].longitude,
        gpsPoints[i].latitude,
        gpsPoints[i].longitude
      );
    }
    return totalMeters / 1000;
  }, [journey?.total_distance_km, gpsPoints]);

  // Duration computation
  const journeyDuration = useMemo(() => {
    if (!journey?.started_at) return 'N/A';
    const start = new Date(journey.started_at).getTime();
    const end = journey.ended_at ? new Date(journey.ended_at).getTime() : Date.now();
    const diffMin = Math.max(0, Math.round((end - start) / 60000));
    if (diffMin < 60) return `${diffMin} min${diffMin !== 1 ? 's' : ''}`;
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hrs} hr ${mins} min${mins !== 1 ? 's' : ''}`;
  }, [journey?.started_at, journey?.ended_at]);

  // Formatted date
  const journeyDate = useMemo(() => {
    if (!journey?.started_at) return 'N/A';
    return new Date(journey.started_at).toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [journey?.started_at]);

  // Extracted route polyline coordinates strictly from verified GPS breadcrumbs
  const polylineCoords: [number, number][] = useMemo(() => {
    return gpsPoints.map((p) => [p.latitude, p.longitude] as [number, number]);
  }, [gpsPoints]);

  // Coordinates for START and DESTINATION
  const startCoord: [number, number] | null = useMemo(() => {
    if (journey && journey.origin_lat != null && journey.origin_lng != null && !isNaN(journey.origin_lat) && !isNaN(journey.origin_lng)) {
      return [journey.origin_lat, journey.origin_lng];
    }
    if (gpsPoints.length > 0) {
      return [gpsPoints[0].latitude, gpsPoints[0].longitude];
    }
    return null;
  }, [journey, gpsPoints]);

  const destCoord: [number, number] | null = useMemo(() => {
    if (journey && journey.destination_lat != null && journey.destination_lng != null && !isNaN(journey.destination_lat) && !isNaN(journey.destination_lng)) {
      return [journey.destination_lat, journey.destination_lng];
    }
    return null;
  }, [journey]);

  // Subsample intermediate markers to prevent map clutter (up to 30 representative markers)
  const sampledIntermediatePoints = useMemo(() => {
    if (gpsPoints.length <= 30) return gpsPoints.slice(1, -1);
    const step = Math.ceil(gpsPoints.length / 30);
    const result: JourneyBreadcrumbPoint[] = [];
    for (let i = 1; i < gpsPoints.length - 1; i += step) {
      result.push(gpsPoints[i]);
    }
    return result;
  }, [gpsPoints]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-semibold text-zinc-600">Retrieving verified GPS route telemetry...</p>
      </div>
    );
  }

  if (error || !journey) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate(fromSource === 'active' ? '/company/journeys' : '/company/history')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-zinc-200 text-xs font-bold text-zinc-800 hover:bg-zinc-50 shadow-sm transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{fromSource === 'active' ? 'Back to Active Dispatches' : 'Back to Trip History'}</span>
        </button>
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h3 className="text-base font-bold text-zinc-900">Unable to Load Trip Path</h3>
          <p className="text-xs text-zinc-600 max-w-md mx-auto">{error || 'Trip record not found.'}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans">
      {/* Top Header & Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(fromSource === 'active' ? '/company/journeys' : '/company/history')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/90 text-xs font-bold text-zinc-800 shadow-sm transition cursor-pointer"
            title="Return to previous list"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-600" />
            <span>{fromSource === 'active' ? 'Back to Active Dispatches' : 'Back to Trip History'}</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-zinc-900 tracking-tight">
                Travelled Route: <span className="font-mono text-[#0071E3]">{journey.vehicle_registration || 'Vehicle'}</span>
              </h2>
              <StatusBadge status={journey.status} size="sm" />
              {isLive && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                  {wsConnected ? 'LIVE STREAM' : 'POLLING 7s'}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 font-medium mt-0.5">
              Actual recorded GPS breadcrumb path from <span className="font-semibold text-zinc-800">{journey.origin_name}</span> to{' '}
              <span className="font-semibold text-zinc-800">{journey.destination_name}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTriggerFit((n) => n + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/90 text-xs font-bold text-zinc-800 shadow-sm transition cursor-pointer"
            title="Re-center map on complete route"
          >
            <Crosshair className="w-3.5 h-3.5 text-[#0071E3]" />
            <span>Fit Route</span>
          </button>
          <button
            onClick={() => setMapStyle((s) => (s === 'apple' ? 'dark' : 'apple'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/90 text-xs font-bold text-zinc-800 shadow-sm transition cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-zinc-600" />
            <span>{mapStyle === 'apple' ? 'Apple Light' : 'Night Glass'}</span>
          </button>
          <button
            onClick={loadTripData}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200/80 text-xs font-bold text-zinc-800 transition cursor-pointer disabled:opacity-50"
            title="Refresh GPS telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-700 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Journey Detail Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Card 1: Asset & Driver */}
        <Card className="p-3.5 border border-black/[0.06] bg-white shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
            <Car className="w-3.5 h-3.5 text-[#0071E3]" />
            <span>Vehicle & Driver</span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <span className="font-mono text-base font-bold text-zinc-900">{journey.vehicle_registration || 'VAN'}</span>
            <span className="text-xs font-semibold text-zinc-600 truncate ml-2">{journey.driver_name || 'Driver'}</span>
          </div>
          <p className="text-[11px] text-zinc-500 truncate">{journey.description || 'Dispatched Delivery Journey'}</p>
        </Card>

        {/* Card 2: Route Origin & Departure */}
        <Card className="p-3.5 border border-black/[0.06] bg-white shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Origin Departure</span>
          </div>
          <p className="font-bold text-xs text-zinc-900 truncate pt-1">{journey.origin_name || 'Origin'}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono">
            <Clock className="w-3 h-3 text-zinc-400" />
            <span>{journey.started_at ? new Date(journey.started_at).toLocaleTimeString() : 'N/A'}</span>
            <span className="text-zinc-300">•</span>
            <span>{journeyDate}</span>
          </div>
        </Card>

        {/* Card 3: Destination & Arrival */}
        <Card className="p-3.5 border border-black/[0.06] bg-white shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rose-600 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            <span>Destination</span>
          </div>
          <p className="font-bold text-xs text-zinc-900 truncate pt-1">{journey.destination_name || 'Destination'}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono">
            <Flag className="w-3 h-3 text-zinc-400" />
            <span>
              {journey.ended_at ? new Date(journey.ended_at).toLocaleTimeString() : isLive ? 'In Transit' : 'Scheduled'}
            </span>
            <span className="text-zinc-300">•</span>
            <span className="font-bold text-zinc-700">{journey.status}</span>
          </div>
        </Card>

        {/* Card 4: Metrics (Distance, Duration, GPS Points) */}
        <Card className="p-3.5 border border-black/[0.06] bg-white shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 text-indigo-500" />
            <span>Journey Metrics</span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div>
              <span className="text-base font-extrabold text-zinc-900 font-mono">
                {calculatedDistanceKm > 0 ? calculatedDistanceKm.toFixed(2) : '0.00'}
              </span>
              <span className="text-[11px] font-bold text-zinc-500 ml-1">km</span>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold text-zinc-800">{journeyDuration}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-500 pt-0.5 border-t border-black/[0.04]">
            <span className="flex items-center gap-1">
              <Gauge className="w-3 h-3 text-zinc-400" />
              {latestLivePing ? `${Math.round(latestLivePing.speed)} km/h` : '0 km/h'}
            </span>
            <span className="font-mono text-[#0071E3] font-bold">{gpsPoints.length} GPS breadcrumbs</span>
          </div>
        </Card>
      </div>

      {/* Data Integrity Notices */}
      {gpsPoints.length === 0 ? (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2.5 shadow-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <strong className="font-bold">No GPS Breadcrumbs Recorded:</strong> The vehicle did not transmit GPS telemetry for this journey. The route cannot be reconstructed. Origin and scheduled destination markers are displayed.
          </div>
        </div>
      ) : gpsPoints.length < 3 ? (
        <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center gap-2.5 shadow-sm">
          <Activity className="w-4 h-4 text-blue-600 shrink-0" />
          <div>
            <strong className="font-bold">Partial GPS Track:</strong> Only {gpsPoints.length} GPS fix recorded. Displaying available breadcrumbs without artificial extrapolation.
          </div>
        </div>
      ) : null}

      {/* Main Interactive Map Viewport */}
      <div className="relative w-full h-[calc(100vh-300px)] min-h-[480px] rounded-2xl overflow-hidden border border-black/[0.08] shadow-xl">
        <MapContainer
          center={startCoord || [13.0827, 80.2707]}
          zoom={13}
          scrollWheelZoom={true}
          className="w-full h-full"
        >
          <TileLayer
            key={mapStyle}
            attribution={getMapTileConfig(mapStyle).attribution}
            url={getMapTileConfig(mapStyle).url}
            maxZoom={getMapTileConfig(mapStyle).maxZoom}
            tileSize={getMapTileConfig(mapStyle).tileSize}
            className={getMapTileConfig(mapStyle).className}
          />

          <TripBoundsController
            points={polylineCoords}
            startCoord={startCoord}
            destCoord={destCoord}
            triggerFit={triggerFit}
          />

          {/* Actual Travelled Route Polyline (Bright Blue Highlighted) */}
          {polylineCoords.length > 1 && (
            <>
              {/* Soft glowing outer halo (bright blue) */}
              <Polyline
                positions={polylineCoords}
                pathOptions={{
                  color: '#0071E3',
                  weight: 8,
                  opacity: 0.35,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {/* Crisp vibrant inner route (bright blue core) */}
              <Polyline
                positions={polylineCoords}
                pathOptions={{
                  color: '#0071E3',
                  weight: 4.5,
                  opacity: 1.0,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </>
          )}

          {/* Intermediate GPS Breadcrumb Markers (Clickable dots) */}
          {sampledIntermediatePoints.map((pt, idx) => (
            <CircleMarker
              key={pt.id || idx}
              center={[pt.latitude, pt.longitude]}
              radius={3.5}
              pathOptions={{
                color: '#ffffff',
                fillColor: '#0071E3',
                fillOpacity: 0.9,
                weight: 1.5,
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[150px] font-sans text-xs">
                  <span className="font-bold text-[#0071E3] block mb-0.5">GPS Fix #{idx + 1}</span>
                  <p className="text-[11px] text-zinc-600 font-mono">
                    Time: {new Date(pt.recorded_at).toLocaleTimeString()}
                  </p>
                  <p className="text-[11px] text-zinc-600 font-mono">
                    Speed: {Math.round(pt.speed)} km/h
                  </p>
                  <p className="text-[11px] text-zinc-600 font-mono">
                    Heading: {Math.round(pt.heading)}°
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    {pt.latitude.toFixed(5)}, {pt.longitude.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {/* START Location Marker (Green) */}
          {startCoord && (
            <Marker position={startCoord} icon={startIcon}>
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[180px] font-sans">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block mb-1">
                    Journey Origin (Start)
                  </span>
                  <p className="font-bold text-xs text-zinc-900">{journey.origin_name || 'Origin'}</p>
                  <p className="text-[11px] text-zinc-600 font-mono mt-1">
                    Departure: {journey.started_at ? new Date(journey.started_at).toLocaleString() : 'N/A'}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    {startCoord[0].toFixed(5)}, {startCoord[1].toFixed(5)}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* DESTINATION Location Marker (Red) */}
          {destCoord && (
            <Marker position={destCoord} icon={destinationIcon}>
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[180px] font-sans">
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block mb-1">
                    Target Destination
                  </span>
                  <p className="font-bold text-xs text-zinc-900">{journey.destination_name || 'Destination'}</p>
                  <p className="text-[11px] text-zinc-600 font-mono mt-1">
                    {journey.ended_at
                      ? `Completed: ${new Date(journey.ended_at).toLocaleString()}`
                      : isLive
                      ? 'Status: In Transit'
                      : 'Scheduled Goal'}
                  </p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    {destCoord[0].toFixed(5)}, {destCoord[1].toFixed(5)}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Moving Vehicle Marker for Live Journey */}
          {isLive && latestLivePing && (
            <Marker
              position={[latestLivePing.latitude, latestLivePing.longitude]}
              icon={createLiveVehicleIcon(latestLivePing.heading || 0, latestLivePing.speed || 0)}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[180px] font-sans">
                  <div className="flex items-center justify-between border-b pb-1 mb-1">
                    <span className="text-xs font-bold text-[#0071E3] font-mono">{journey.vehicle_registration}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                      {Math.round(latestLivePing.speed)} km/h
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-zinc-800">Driver: {journey.driver_name}</p>
                  <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                    Last update: {new Date(latestLivePing.recorded_at).toLocaleTimeString()}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
};
