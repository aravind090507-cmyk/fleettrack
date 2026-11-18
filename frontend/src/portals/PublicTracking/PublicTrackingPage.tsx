import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck,
  Radio,
  AlertOctagon,
  Gauge,
  MapPin,
  Navigation,
  Compass,
  Clock,
  Activity,
  Layers,
  ChevronUp,
  ChevronDown,
  Share2,
  CheckCircle2,
  AlertTriangle,
  Coffee,
  Flag,
  Crosshair,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { trackingApi } from '../../services/api';
import { LatestLocation, TrackingInfo, WebSocketMessage, PublicTripEvent } from '../../types';
import { TrackingMap } from '../../components/map/TrackingMap';
import { useWebSocket } from '../../hooks/useWebSocket';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { normalizeUtcTimestamp } from '../../utils/time';

/**
 * Format heading degrees into compass direction string (e.g. 45 -> "NE (45°)")
 */
function formatHeading(deg?: number): string {
  if (deg === undefined || deg === null || isNaN(deg)) return 'N/A';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return `${dirs[idx]} (${Math.round(deg)}°)`;
}

/**
 * Format seconds into HH:MM:SS
 */
function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Safe Base64URL JWT Decoder for Public Tracking Tokens
 */
function decodeTrackingJwt(token: string | undefined): TrackingInfo | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonStr = new TextDecoder().decode(bytes);
    const p = JSON.parse(jsonStr);

    if (!p || typeof p !== 'object') return null;

    const rawStarted = p.st || new Date().toISOString();
    const normalizedStarted = normalizeUtcTimestamp(rawStarted) || new Date().toISOString();

    const olat = typeof p.olat === 'number' ? p.olat : parseFloat(p.olat) || 13.020767;
    const olng = typeof p.olng === 'number' ? p.olng : parseFloat(p.olng) || 80.178377;
    const dlat = typeof p.dlat === 'number' ? p.dlat : parseFloat(p.dlat) || olat;
    const dlng = typeof p.dlng === 'number' ? p.dlng : parseFloat(p.dlng) || olng;

    return {
      journey_id: p.jid || '',
      vehicle_id: p.vid || undefined,
      vehicle_registration: p.vreg || 'FLEET-01',
      vehicle_type: p.vtype || 'VAN',
      driver_id: p.did || undefined,
      driver_name: p.dname || 'Assigned Driver',
      origin_name: p.oname || 'Origin Location',
      destination_name: p.destname || 'Destination Location',
      origin_lat: olat,
      origin_lng: olng,
      destination_lat: dlat,
      destination_lng: dlng,
      status: 'IN_PROGRESS',
      started_at: normalizedStarted,
      latest_location: {
        latitude: olat,
        longitude: olng,
        speed: 0,
        heading: 0,
        accuracy: 5,
        recorded_at: normalizedStarted,
      },
      eta_minutes: undefined,
      distance_remaining_km: undefined,
      distance_travelled_km: 0,
      duration_seconds: 0,
      trip_events: [],
    };
  } catch (err) {
    console.warn('Safe Base64URL JWT decoder caught token parse error:', err);
    return null;
  }
}

export const PublicTrackingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  // Immediate synchronous fallback from JWT payload claims so the page never renders blank
  const fallbackInfo = useMemo(() => decodeTrackingJwt(token), [token]);

  const [trackingInfo, setTrackingInfo] = useState<TrackingInfo | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatestLocation | null>(null);
  const [routeHistory, setRouteHistory] = useState<[number, number][]>([]);
  const [tripEvents, setTripEvents] = useState<PublicTripEvent[]>([]);
  const [isEnded, setIsEnded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(!fallbackInfo);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [lastPingTime, setLastPingTime] = useState<number>(Date.now());
  const [secondsSinceLastPing, setSecondsSinceLastPing] = useState<number>(0);
  const [elapsedDuration, setElapsedDuration] = useState<number>(0);
  const [activeSheetTab, setActiveSheetTab] = useState<'metrics' | 'timeline'>('metrics');
  const [isSheetExpanded, setIsSheetExpanded] = useState<boolean>(false);
  const [copiedToast, setCopiedToast] = useState(false);

  // Active tracking state: prioritizes live API response, falls back to decoded JWT claims
  const activeInfo = trackingInfo || fallbackInfo;

  // Synchronize and poll telemetry
  const fetchLiveState = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    if (isEnded) return;

    try {
      const [info, trail] = await Promise.all([
        trackingApi.getInfo(token),
        trackingApi.getTrail(token).catch(() => []),
      ]);

      if (info && info.started_at) {
        info.started_at = normalizeUtcTimestamp(info.started_at) || info.started_at;
      }

      setTrackingInfo(info);
      if (info.trip_events && Array.isArray(info.trip_events)) {
        setTripEvents(info.trip_events);
      }
      setNetworkError(null);
      setLastPingTime(Date.now());

      if (info.latest_location) {
        setCurrentLocation(info.latest_location);
      } else {
        setCurrentLocation({
          latitude: info.origin_lat,
          longitude: info.origin_lng,
          speed: 0,
          heading: 0,
          accuracy: 5,
          recorded_at: info.started_at,
        });
      }

      if (trail && Array.isArray(trail) && trail.length > 0) {
        setRouteHistory(
          trail
            .filter((t: any) => typeof t?.latitude === 'number' && typeof t?.longitude === 'number' && !isNaN(t.latitude) && !isNaN(t.longitude))
            .map((t: any) => [t.latitude, t.longitude] as [number, number])
        );
      } else if (info.latest_location && !isNaN(info.latest_location.latitude) && !isNaN(info.latest_location.longitude)) {
        setRouteHistory([[info.latest_location.latitude, info.latest_location.longitude]]);
      } else if (!isNaN(info.origin_lat) && !isNaN(info.origin_lng)) {
        setRouteHistory([[info.origin_lat, info.origin_lng]]);
      }
    } catch (err: any) {
      if (err.response?.status === 410 || err.response?.status === 404) {
        setIsEnded(true);
      } else {
        setNetworkError('Reconnecting to fleet tracking service...');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, isEnded]);

  // Keep track of time elapsed since last ping
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsSinceLastPing(Math.floor((Date.now() - lastPingTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastPingTime]);

  // Live elapsed trip timer
  useEffect(() => {
    if (!activeInfo?.started_at) return;
    const updateElapsed = () => {
      const startMs = new Date(activeInfo.started_at).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      setElapsedDuration(diffSec);
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeInfo?.started_at]);

  // Initial load
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    fetchLiveState();
  }, [fetchLiveState, token]);

  // Seed initial location from fallback claims if API hasn't loaded yet
  useEffect(() => {
    if (!currentLocation && fallbackInfo) {
      setCurrentLocation(fallbackInfo.latest_location || {
        latitude: fallbackInfo.origin_lat,
        longitude: fallbackInfo.origin_lng,
        speed: 0,
        heading: 0,
        accuracy: 5,
        recorded_at: fallbackInfo.started_at,
      });
      setRouteHistory([[fallbackInfo.origin_lat, fallbackInfo.origin_lng]]);
    }
  }, [fallbackInfo, currentLocation]);

  // Handle live WebSocket telemetry updates
  const handleWebSocketMessage = useCallback((msg: WebSocketMessage) => {
    if (msg.type === 'LOCATION_UPDATE') {
      const newLoc: LatestLocation = {
        latitude: msg.latitude,
        longitude: msg.longitude,
        speed: msg.speed,
        heading: msg.heading,
        accuracy: msg.accuracy || 0,
        recorded_at: msg.recorded_at,
      };
      setCurrentLocation(newLoc);
      setLastPingTime(Date.now());
      setRouteHistory((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (Math.abs(last[0] - msg.latitude) < 0.00001 && Math.abs(last[1] - msg.longitude) < 0.00001) {
            return prev;
          }
        }
        return [...prev, [msg.latitude, msg.longitude]];
      });
    } else if (msg.type === 'TRIP_EVENT' || msg.type === 'GEOFENCE_ALERT') {
      // Add live event to timeline
      const newEvent: PublicTripEvent = {
        id: `evt-${Date.now()}`,
        event_type: msg.event_type || 'UPDATE',
        latitude: msg.latitude || 0,
        longitude: msg.longitude || 0,
        description: msg.event_type ? `Milestone: ${msg.event_type.replace('_', ' ')}` : 'Operational update',
        created_at: new Date().toISOString(),
      };
      setTripEvents((prev) => [newEvent, ...prev]);
    } else if (msg.type === 'JOURNEY_COMPLETED') {
      setIsEnded(true);
    }
  }, []);

  const handleJourneyCompleted = useCallback(() => {
    setIsEnded(true);
  }, []);

  const wsUrl = token ? `/ws/track/${token}` : null;
  const { isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
    onJourneyCompleted: handleJourneyCompleted,
    onReconnect: fetchLiveState,
  });

  // Safety REST fallback polling every 10s only while WebSocket is disconnected
  useEffect(() => {
    if (isEnded || !token || isConnected) return;
    const interval = setInterval(() => {
      fetchLiveState();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchLiveState, isEnded, token, isConnected]);

  // If the journey has concluded or token expired (HTTP 410 / Code 4410)
  if (isEnded) {
    return (
      <div className="min-h-screen bg-[#1C1C1E] flex items-center justify-center p-6 text-center select-none font-sans">
        <div className="max-w-md w-full bg-[#2C2C2E] border border-white/10 rounded-3xl p-8 shadow-2xl space-y-5 animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto shadow-xl">
            <AlertOctagon className="w-8 h-8 text-rose-500" />
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              TRACKING ENDED (HTTP 410)
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight mt-3">
              This Journey Has Concluded
            </h1>
            <p className="text-xs text-zinc-400 mt-2 font-medium">
              The destination has been reached and the ephemeral tracking credentials have been permanently revoked in accordance with privacy safeguards.
            </p>
          </div>

          <div className="p-4 bg-black/40 rounded-2xl border border-white/5 text-[11px] text-zinc-400 leading-relaxed font-sans text-left">
            <p className="font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Ephemeral Privacy Protection:
            </p>
            Public tracking links expire immediately upon journey completion to protect driver privacy and asset telemetry.
          </div>

          <div className="pt-1 text-[10px] text-zinc-500 font-mono tracking-wider uppercase">
            FleetTrack Enterprise Telematics
          </div>
        </div>
      </div>
    );
  }

  // Only show fullScreen LoadingSpinner if neither API info NOR decoded JWT claims are available
  if (isLoading && !activeInfo) {
    return <LoadingSpinner label="Resolving temporary tracking link..." fullScreen />;
  }

  // If token is invalid or completely missing and no claims exist
  if (!activeInfo) {
    return (
      <div className="min-h-screen bg-[#1C1C1E] flex items-center justify-center p-6 text-center select-none font-sans">
        <div className="max-w-md w-full bg-[#2C2C2E] border border-white/10 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center mx-auto shadow-xl">
            <Radio className="w-8 h-8 animate-pulse text-blue-400" />
          </div>
          <h2 className="text-base font-bold text-white uppercase tracking-wide">Connecting to Telematics Hub</h2>
          <p className="text-xs text-zinc-400">
            {networkError || 'Establishing encrypted telemetry stream with driver unit...'}
          </p>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchLiveState();
            }}
            className="px-5 py-2.5 bg-[#0071E3] hover:bg-blue-600 text-white rounded-xl text-xs font-semibold uppercase tracking-wider transition shadow-lg cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Status Badges (C.7)
  const isStale = secondsSinceLastPing > 60;
  const isReconnecting = !isConnected && !isStale;

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2400);
  };

  const etaDisplay = activeInfo.eta_minutes != null
    ? activeInfo.eta_minutes < 1 && (activeInfo.distance_remaining_km ?? 999) < 0.1
      ? 'Arrived'
      : activeInfo.eta_minutes < 60
      ? `${Math.round(activeInfo.eta_minutes)} min`
      : `${Math.floor(activeInfo.eta_minutes / 60)}h ${Math.round(activeInfo.eta_minutes % 60)}m`
    : 'Calculating...';

  // Distance calculations
  const distTraveled = activeInfo.distance_travelled_km != null && activeInfo.distance_travelled_km > 0
    ? activeInfo.distance_travelled_km
    : (routeHistory.length > 1 ? (routeHistory.length * 0.05) : 0);
  const distRemaining = activeInfo.distance_remaining_km ?? 0;
  const totalDist = distTraveled + distRemaining;
  const progressPercent = totalDist > 0
    ? Math.min(Math.max(Math.round((distTraveled / totalDist) * 100), 5), 98)
    : 35;

  return (
    <div className="flex flex-col h-screen bg-[#F2F2F7] text-[#1C1C1E] overflow-hidden relative font-sans select-none">
      
      {/* C.1 & C.7: FLOATING TOP DYNAMIC BAR */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto w-[94vw] max-w-xl">
        <div className="bg-black/90 text-white backdrop-blur-2xl rounded-2xl px-4 py-2.5 shadow-2xl border border-white/15 flex items-center justify-between transition-all">
          
          {/* Status Indicator & Registration */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              {isStale ? (
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-4 ring-amber-500/20" />
              ) : isConnected ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <div className="absolute w-5 h-5 rounded-full bg-emerald-400/40 animate-ping" />
                </>
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs text-white font-mono tracking-wider">
                  {activeInfo.vehicle_registration}
                </span>
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-white/10 text-zinc-300">
                  {activeInfo.vehicle_type}
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 truncate max-w-[150px]">
                Driver: {activeInfo.driver_name}
              </p>
            </div>
          </div>

          {/* Central ETA & State Badge */}
          <div className="flex items-center gap-2">
            {isStale ? (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> STALE ({secondsSinceLastPing}s)
              </span>
            ) : isReconnecting ? (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                <WifiOff className="w-2.5 h-2.5" /> RECONNECTING
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Wifi className="w-2.5 h-2.5" /> LIVE
              </span>
            )}
            <div className="text-right pl-2 border-l border-white/15">
              <span className="text-[10px] text-zinc-400 uppercase font-medium block leading-none">ETA</span>
              <span className="text-xs font-bold text-emerald-400">{etaDisplay}</span>
            </div>
          </div>
        </div>
      </div>

      {/* C.2: INTERACTIVE LEAFLET TRACKING MAP */}
      <div className="flex-1 w-full h-full relative z-0">
        <TrackingMap
          currentLocation={currentLocation}
          origin={{
            lat: activeInfo.origin_lat,
            lng: activeInfo.origin_lng,
            name: activeInfo.origin_name,
          }}
          destination={{
            lat: activeInfo.destination_lat,
            lng: activeInfo.destination_lng,
            name: activeInfo.destination_name,
          }}
          routeHistory={routeHistory}
        />
      </div>

      {/* C.1, C.3, C.4, C.5: CONSUMER DASHBOARD BOTTOM SHEET */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[94vw] max-w-lg z-20 pointer-events-auto">
        <div className="bg-white/90 backdrop-blur-2xl rounded-3xl p-4 shadow-2xl border border-white/80 transition-all">
          
          {/* Header Controls & Tab Switcher */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded-xl border border-black/[0.04]">
              <button
                type="button"
                onClick={() => setActiveSheetTab('metrics')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSheetTab === 'metrics'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Live Telemetry
              </button>
              <button
                type="button"
                onClick={() => setActiveSheetTab('timeline')}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  activeSheetTab === 'timeline'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <span>Trip Events</span>
                {tripEvents.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-[#0071E3] text-[9px] font-extrabold">
                    {tripEvents.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                title="Share Tracking Link"
                className="p-2 rounded-xl bg-blue-50 text-[#0071E3] hover:bg-blue-100 transition-colors text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{copiedToast ? 'Copied!' : 'Share'}</span>
              </button>
              <button
                onClick={() => setIsSheetExpanded(!isSheetExpanded)}
                title={isSheetExpanded ? 'Minimize' : 'Expand'}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                {isSheetExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* TAB 1: METRICS & JOURNEY PROGRESSION */}
          {activeSheetTab === 'metrics' && (
            <div className="space-y-3">
              {/* C.3: Journey Progression Stepper */}
              <div className="p-3 bg-zinc-50/80 rounded-2xl border border-black/[0.04] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-zinc-700 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-zinc-900 shrink-0" />
                    <span className="truncate max-w-[120px] text-[11px]">{activeInfo.origin_name}</span>
                  </div>
                  <span className="text-[#0071E3] font-mono text-[11px] font-extrabold shrink-0 px-2">
                    {progressPercent}%
                  </span>
                  <div className="flex items-center gap-1.5 text-emerald-700 min-w-0 justify-end">
                    <span className="truncate max-w-[120px] text-[11px] text-right">{activeInfo.destination_name}</span>
                    <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-zinc-200/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-[#0071E3] to-emerald-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-medium pt-0.5">
                  <span>Traveled: <strong>{distTraveled.toFixed(1)} km</strong></span>
                  <span>Duration: <strong>{formatDuration(elapsedDuration)}</strong></span>
                  <span>Remaining: <strong>{distRemaining.toFixed(1)} km</strong></span>
                </div>
              </div>

              {/* C.4: Live Vehicle Information 4-Pill Grid */}
              <div className="grid grid-cols-4 gap-2">
                {/* Speed */}
                <div className="bg-white rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-center gap-1">
                    <Gauge className="w-3 h-3 text-[#0071E3]" /> Speed
                  </div>
                  <div className="text-sm font-bold text-zinc-900 mt-1">
                    {currentLocation?.speed || 0}{' '}
                    <span className="text-[10px] font-normal text-zinc-500">km/h</span>
                  </div>
                </div>

                {/* Heading / Direction */}
                <div className="bg-white rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-center gap-1">
                    <Compass className="w-3 h-3 text-indigo-500" /> Heading
                  </div>
                  <div className="text-xs font-bold text-zinc-900 mt-1 truncate">
                    {formatHeading(currentLocation?.heading)}
                  </div>
                </div>

                {/* GPS Accuracy */}
                <div className="bg-white rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-center gap-1">
                    <Crosshair className="w-3 h-3 text-emerald-500" /> GPS
                  </div>
                  <div className="text-xs font-bold text-zinc-900 mt-1">
                    ±{currentLocation?.accuracy ? Math.round(currentLocation.accuracy) : 5}m
                  </div>
                </div>

                {/* Total Traveled */}
                <div className="bg-white rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-center gap-1">
                    <Activity className="w-3 h-3 text-amber-500" /> Distance
                  </div>
                  <div className="text-xs font-bold text-zinc-900 mt-1">
                    {distTraveled.toFixed(1)}{' '}
                    <span className="text-[10px] font-normal text-zinc-500">km</span>
                  </div>
                </div>
              </div>

              {/* Collapsible Details */}
              {isSheetExpanded && (
                <div className="pt-2 border-t border-black/[0.06] text-xs space-y-1.5 text-zinc-600 animate-fadeIn">
                  <div className="flex justify-between">
                    <span className="font-medium text-zinc-500">Journey ID:</span>
                    <span className="font-mono text-zinc-800">{activeInfo.journey_id ? `REF-${activeInfo.journey_id.slice(0, 8)}` : 'ACTIVE-TRIP'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-zinc-500">Last Telemetry Ping:</span>
                    <span className="text-zinc-800">
                      {secondsSinceLastPing === 0 ? 'Just now' : `${secondsSinceLastPing}s ago`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-zinc-500">Assigned Driver:</span>
                    <span className="font-bold text-zinc-800">{activeInfo.driver_name}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: C.5 TRIP EVENT TIMELINE */}
          {activeSheetTab === 'timeline' && (
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {tripEvents.length === 0 ? (
                <div className="text-center py-6 text-zinc-400">
                  <Activity className="w-6 h-6 mx-auto mb-1 opacity-50" />
                  <p className="text-xs font-medium">No operational events reported yet.</p>
                  <p className="text-[10px] text-zinc-400">Events such as Departure, Breaks, Stops, and Arrivals appear here.</p>
                </div>
              ) : (
                <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200">
                  {tripEvents.map((evt, idx) => {
                    const isAlert = ['SOS', 'BREAKDOWN', 'INCIDENT'].includes(evt.event_type?.toUpperCase());
                    const isArrival = evt.event_type?.toUpperCase() === 'ARRIVAL';
                    const isDeparture = evt.event_type?.toUpperCase() === 'DEPARTURE';

                    return (
                      <div key={evt.id || idx} className="relative flex items-start gap-2.5 text-xs">
                        {/* Dot */}
                        <div
                          className={`absolute -left-4 top-1 w-3 h-3 rounded-full border-2 border-white ${
                            isAlert
                              ? 'bg-rose-500'
                              : isArrival
                              ? 'bg-emerald-500'
                              : isDeparture
                              ? 'bg-blue-600'
                              : 'bg-zinc-400'
                          }`}
                        />
                        <div className="flex-1 min-w-0 bg-zinc-50 p-2 rounded-xl border border-black/[0.04]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-bold text-zinc-900 text-[11px]">
                              {evt.event_type.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {evt.created_at
                                ? new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : ''}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-600 leading-tight">
                            {evt.description || 'Milestone logged along journey route.'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Privacy Note (C.6) */}
          <div className="pt-2 text-[10px] text-center text-zinc-400 font-medium">
            Protected by FleetTrack Ephemeral Telematics Protocol • Read-Only
          </div>
        </div>
      </div>

      {/* TOAST FEEDBACK */}
      {copiedToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-black/90 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl border border-white/20 animate-fadeIn">
          Tracking link copied to clipboard!
        </div>
      )}

    </div>
  );
};
