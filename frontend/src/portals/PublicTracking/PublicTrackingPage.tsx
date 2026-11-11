import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, Radio, AlertOctagon, Gauge, MapPin, Navigation } from 'lucide-react';
import { trackingApi } from '../../services/api';
import { LatestLocation, TrackingInfo, WebSocketMessage } from '../../types';
import { TrackingMap } from '../../components/map/TrackingMap';
import { useWebSocket } from '../../hooks/useWebSocket';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

export const PublicTrackingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [trackingInfo, setTrackingInfo] = useState<TrackingInfo | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatestLocation | null>(null);
  const [routeHistory, setRouteHistory] = useState<[number, number][]>([]);
  const [isEnded, setIsEnded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [lastPingTime, setLastPingTime] = useState<number>(Date.now());
  const [secondsSinceLastPing, setSecondsSinceLastPing] = useState<number>(0);

  // Synchronize and poll telemetry
  const fetchLiveState = useCallback(async () => {
    if (!token || isEnded) return;

    try {
      const [info, trail] = await Promise.all([
        trackingApi.getInfo(token),
        trackingApi.getTrail(token).catch(() => []),
      ]);

      setTrackingInfo(info);
      setNetworkError(null);
      setLastPingTime(Date.now());

      if (info.latest_location) {
        setCurrentLocation(info.latest_location);
      } else {
        // Fallback to origin location while journey is initiating
        setCurrentLocation({
          latitude: info.origin_lat,
          longitude: info.origin_lng,
          speed: 0,
          heading: 0,
          accuracy: 5,
          recorded_at: info.started_at,
        });
      }

      if (trail && trail.length > 0) {
        setRouteHistory(trail.map((t: any) => [t.latitude, t.longitude] as [number, number]));
      } else if (info.latest_location) {
        setRouteHistory([[info.latest_location.latitude, info.latest_location.longitude]]);
      } else {
        setRouteHistory([[info.origin_lat, info.origin_lng]]);
      }
    } catch (err: any) {
      if (err.response?.status === 410) {
        setIsEnded(true);
      } else if (err.response?.status === 404) {
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

  // Initial load
  useEffect(() => {
    fetchLiveState();
  }, [fetchLiveState]);

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
      setRouteHistory((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (Math.abs(last[0] - msg.latitude) < 0.00001 && Math.abs(last[1] - msg.longitude) < 0.00001) {
            return prev;
          }
        }
        return [...prev, [msg.latitude, msg.longitude]];
      });
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

  if (isLoading) {
    return <LoadingSpinner label="Resolving temporary tracking link..." fullScreen />;
  }

  // If the journey has concluded or token expired
  if (isEnded) {
    return (
      <div className="min-h-screen bg-bespoke-dark flex items-center justify-center p-6 text-center select-none font-sans">
        <div className="max-w-md w-full bg-bespoke-surface border border-bespoke-border rounded-xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-xl bg-bespoke-error/15 border border-bespoke-error/40 text-bespoke-linen flex items-center justify-center mx-auto shadow-xl">
            <AlertOctagon className="w-8 h-8 text-bespoke-error" />
          </div>

          <div>
            <h1 className="text-xl font-light text-bespoke-offwhite tracking-wider uppercase">
              THIS JOURNEY HAS CONCLUDED
            </h1>
            <p className="text-sm text-bespoke-champagne/70 mt-2 font-normal">
              Tracking session has expired.
            </p>
          </div>

          <div className="p-4 bg-bespoke-black/80 rounded border border-bespoke-border text-xs text-bespoke-dim leading-relaxed font-sans">
            In accordance with advisory security protocols, temporary journey credentials are permanently revoked (HTTP
            410 Gone) immediately upon destination conclusion.
          </div>

          <div className="pt-2 text-[10px] text-bespoke-dim font-mono tracking-[0.14em] uppercase">
            Bespoke Telematics Advisory Protocol
          </div>
        </div>
      </div>
    );
  }

  // If temporary connection issue while trackingInfo is not yet loaded
  if (!trackingInfo) {
    return (
      <div className="min-h-screen bg-bespoke-dark flex items-center justify-center p-6 text-center select-none font-sans">
        <div className="max-w-md w-full bg-bespoke-surface border border-bespoke-border rounded-xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-xl bg-bespoke-card border border-bespoke-gold/30 text-bespoke-gold flex items-center justify-center mx-auto shadow-xl">
            <Radio className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-base font-light text-bespoke-offwhite uppercase tracking-wide">Connecting to Telematics Hub</h2>
          <p className="text-xs text-bespoke-champagne/70">
            {networkError || 'Establishing encrypted telemetry stream with driver unit...'}
          </p>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchLiveState();
            }}
            className="px-5 py-2.5 bg-bespoke-gold hover:bg-bespoke-goldHover text-bespoke-black rounded text-xs font-semibold uppercase tracking-[0.08em] transition shadow-lg"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const isSignalLost = secondsSinceLastPing > 15;
  const [copiedToast, setCopiedToast] = useState(false);

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2400);
  };

  const etaDisplay = trackingInfo.eta_minutes != null
    ? trackingInfo.eta_minutes < 1 && (trackingInfo.distance_remaining_km ?? 999) < 0.1
      ? 'Arrived'
      : trackingInfo.eta_minutes < 60
      ? `${Math.round(trackingInfo.eta_minutes)} min`
      : `${Math.floor(trackingInfo.eta_minutes / 60)}h ${Math.round(trackingInfo.eta_minutes % 60)}m`
    : 'Calculating...';

  // Calculate approximate completion progress
  const totalApprox = (trackingInfo.distance_remaining_km != null && routeHistory.length > 0)
    ? Math.min(Math.max(Math.round((routeHistory.length / (routeHistory.length + (trackingInfo.distance_remaining_km * 3))) * 100), 15), 98)
    : 45;

  return (
    <div className="flex flex-col h-screen bg-[#F2F2F7] text-[#1C1C1E] overflow-hidden relative font-sans select-none">
      
      {/* FLOATING APPLE DYNAMIC ISLAND (TOP CENTER) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <div className="bg-black/90 text-white backdrop-blur-2xl rounded-full px-5 py-2.5 shadow-2xl flex items-center space-x-3.5 border border-white/15 transition-all">
          <div className="relative flex items-center justify-center">
            <div className={`w-2.5 h-2.5 rounded-full ${isSignalLost ? 'bg-amber-400' : 'bg-emerald-500'}`} />
            <div className={`absolute w-5 h-5 rounded-full ${isSignalLost ? 'bg-amber-400/40 animate-ping' : 'bg-emerald-400/40 animate-ping'}`} />
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <span className="font-semibold text-zinc-300 font-mono tracking-wider">{trackingInfo.vehicle_registration}</span>
            <span className="text-zinc-600">•</span>
            <span className="font-bold text-emerald-400">{etaDisplay}</span>
            {trackingInfo.distance_remaining_km != null && (
              <>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-300">{trackingInfo.distance_remaining_km.toFixed(1)} km</span>
              </>
            )}
          </div>
          <div className="pl-2 border-l border-zinc-700/80 flex items-center space-x-1.5 text-zinc-400 text-xs">
            <span className="text-[10px] uppercase font-semibold text-blue-400">
              {isSignalLost ? 'SYNC PAUSED' : isConnected ? 'LIVE 5G' : 'GPS'}
            </span>
          </div>
        </div>
      </div>

      {/* TOP LEFT ROUTE HUD */}
      <div className="absolute top-4 left-4 z-20 hidden sm:block pointer-events-auto">
        <div className="apple-glass rounded-2xl px-4 py-3 shadow-lg border border-white/80 max-w-xs">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-lg shadow-md shadow-emerald-500/25">
              <Navigation className="w-5 h-5" />
            </div>
            <div className="truncate">
              <div className="text-[10px] font-bold tracking-wider uppercase text-emerald-600">Heading to</div>
              <div className="text-xs font-bold text-zinc-900 truncate">{trackingInfo.destination_name}</div>
            </div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE APPLE MAP */}
      <div className="flex-1 w-full h-full">
        <TrackingMap
          currentLocation={currentLocation}
          origin={{
            lat: trackingInfo.origin_lat,
            lng: trackingInfo.origin_lng,
            name: trackingInfo.origin_name,
          }}
          destination={{
            lat: trackingInfo.destination_lat,
            lng: trackingInfo.destination_lng,
            name: trackingInfo.destination_name,
          }}
          routeHistory={routeHistory}
        />
      </div>

      {/* FLOATING APPLE BOTTOM SHEET */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[92vw] max-w-lg z-30 pointer-events-auto">
        <div className="apple-glass rounded-[28px] p-5 shadow-2xl border border-white/90">
          
          {/* Grabber Handle */}
          <div className="w-10 h-1 bg-zinc-300 rounded-full mx-auto mb-3.5" />

          {/* Vehicle & Driver Identity */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center text-lg shadow-md shadow-blue-500/25">
                <Navigation className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-sm font-bold text-zinc-900 font-mono tracking-tight">
                    {trackingInfo.vehicle_registration}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                    {trackingInfo.vehicle_type}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  Driver: <strong className="text-zinc-800">{trackingInfo.driver_name || 'Assigned Driver'}</strong>
                </p>
              </div>
            </div>

            <button
              onClick={handleShare}
              className="apple-pill-btn px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-500/25 flex items-center space-x-1.5 cursor-pointer"
            >
              <span>{copiedToast ? '✓ Copied' : 'Share ETA'}</span>
            </button>
          </div>

          {/* Metric Grid */}
          <div className="grid grid-cols-4 gap-2 my-3">
            <div className="bg-white/90 rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
              <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-wider">Speed</div>
              <div className="text-sm font-bold text-zinc-900 mt-0.5">
                {currentLocation?.speed || 0} <span className="text-[10px] font-semibold text-zinc-600">km/h</span>
              </div>
            </div>
            <div className="bg-white/90 rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
              <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-wider">ETA</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">{etaDisplay}</div>
            </div>
            <div className="bg-white/90 rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
              <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-wider">Remaining</div>
              <div className="text-sm font-bold text-zinc-900 mt-0.5">
                {trackingInfo.distance_remaining_km != null ? trackingInfo.distance_remaining_km.toFixed(1) : '--'}
                <span className="text-[10px] font-semibold text-zinc-600"> km</span>
              </div>
            </div>
            <div className="bg-white/90 rounded-2xl p-2.5 text-center border border-black/[0.06] shadow-sm">
              <div className="text-[10px] font-bold text-zinc-700 uppercase tracking-wider">Status</div>
              <div className="text-xs font-bold text-[#0071E3] mt-1">
                {isConnected ? 'Live' : 'Syncing'}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="my-2.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-zinc-800 mb-1">
              <span className="truncate max-w-[140px]">{trackingInfo.origin_name}</span>
              <span className="text-blue-600 font-mono">{totalApprox}%</span>
              <span className="truncate max-w-[140px] text-right">{trackingInfo.destination_name}</span>
            </div>
            <div className="w-full bg-zinc-200/80 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-emerald-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${totalApprox}%` }}
              />
            </div>
          </div>

          {/* Emergency / Alert Banner if present */}
          {trackingInfo.latest_event_type && trackingInfo.latest_event_type !== 'RESUME' && (
            <div className="mt-2.5 px-3 py-2 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-900 text-xs font-semibold flex items-center justify-between">
              <span>⚠️ Event: {trackingInfo.latest_event_type}</span>
              {trackingInfo.latest_event_note && (
                <span className="text-zinc-600 text-[11px] font-normal">{trackingInfo.latest_event_note}</span>
              )}
            </div>
          )}

        </div>
      </div>

      {/* TOAST FEEDBACK */}
      {copiedToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-black/90 text-white text-xs font-medium px-4 py-2 rounded-full shadow-2xl border border-white/20 animate-fade-in">
          Tracking link copied to clipboard!
        </div>
      )}

    </div>
  );
};
