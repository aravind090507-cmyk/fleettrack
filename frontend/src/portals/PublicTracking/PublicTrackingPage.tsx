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

  return (
    <div className="flex flex-col h-screen bg-bespoke-dark text-bespoke-offwhite overflow-hidden relative font-sans">
      {/* Top Floating Header */}
      <header className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
        <div className="bg-bespoke-surface/90 border border-bespoke-border backdrop-blur-md px-4 py-2.5 rounded-xl shadow-xl pointer-events-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-bespoke-card border border-bespoke-gold/40 flex items-center justify-center shadow-md">
            <Radio className="w-4 h-4 text-bespoke-gold animate-pulse" />
          </div>
          <div>
            <h2 className="text-xs font-mono font-medium text-bespoke-offwhite uppercase tracking-wider">
              {trackingInfo.vehicle_registration} ({trackingInfo.vehicle_type})
            </h2>
            <p className="text-[11px] text-bespoke-champagne/70">Driver: {trackingInfo.driver_name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {isSignalLost ? (
            <div className="bg-bespoke-error/20 border border-bespoke-error/60 backdrop-blur-md px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-bespoke-error animate-ping" />
              <span className="text-[10px] font-mono font-medium tracking-wide uppercase text-bespoke-linen">
                SIGNAL PAUSED ({secondsSinceLastPing}s)
              </span>
            </div>
          ) : (
            <div className="bg-bespoke-surface/90 border border-bespoke-border backdrop-blur-md px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-bespoke-gold animate-ping" />
              <span className="text-[10px] font-mono font-medium tracking-wide uppercase text-bespoke-gold">
                {isConnected ? 'LIVE TELEMETRY STREAM' : 'REAL-TIME SYNC (2s)'}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Interactive Map */}
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

      {/* Bottom Floating Telemetry Card */}
      <div className="absolute bottom-6 left-4 right-4 max-w-lg mx-auto z-30">
        <div className="bg-bespoke-surface/95 border border-bespoke-border backdrop-blur-xl p-4 rounded-xl shadow-2xl space-y-3">
          <div className="grid grid-cols-2 gap-4 border-b border-bespoke-border pb-3">
            <div>
              <span className="text-[10px] text-bespoke-gold font-mono uppercase tracking-wider block flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-bespoke-gold" />
                Origin Point
              </span>
              <p className="text-xs font-medium text-bespoke-linen truncate">{trackingInfo.origin_name}</p>
            </div>
            <div>
              <span className="text-[10px] text-bespoke-champagne font-mono uppercase tracking-wider block flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-bespoke-champagne" />
                Destination Point
              </span>
              <p className="text-xs font-medium text-bespoke-offwhite truncate">{trackingInfo.destination_name}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex items-center gap-1.5 text-bespoke-champagne">
              <Gauge className="w-4 h-4 text-bespoke-gold" />
              <span>
                Current Speed: <strong className="font-mono text-bespoke-offwhite">{currentLocation?.speed || 0} km/h</strong>
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-bespoke-dim font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-bespoke-gold" />
              <span>Encrypted Stream</span>
            </div>
          </div>

          {/* Event Status Banner */}
          {trackingInfo.latest_event_type && trackingInfo.latest_event_type !== 'RESUME' && (() => {
            const evt = trackingInfo.latest_event_type;
            const isSos = evt === 'SOS';
            const isBreakdown = evt === 'BREAKDOWN';
            const isBreak = evt === 'BREAK';
            const bannerClass = isSos || isBreakdown
              ? 'bg-bespoke-error/20 border-bespoke-error text-bespoke-linen'
              : isBreak
              ? 'bg-amber-950/90 border-amber-800 text-amber-200'
              : 'bg-bespoke-card border-bespoke-border text-bespoke-champagne';
            const label = isSos
              ? '🆘 SOS Emergency'
              : isBreakdown
              ? '⚠️ Vehicle Breakdown Reported'
              : isBreak
              ? '🛑 Driver on Break'
              : `ℹ️ ${evt}`;
            return (
              <div className={`mt-1 px-3 py-2 rounded border text-xs font-mono uppercase ${bannerClass} ${isSos ? 'animate-pulse' : ''}`}>
                {label}
                {trackingInfo.latest_event_note && (
                  <span className="ml-2 font-normal opacity-80">— {trackingInfo.latest_event_note}</span>
                )}
              </div>
            );
          })()}

          {/* RESUME banner */}
          {trackingInfo.latest_event_type === 'RESUME' && (
            <div className="mt-1 px-3 py-2 rounded border bg-bespoke-gold/10 border-bespoke-gold/30 text-bespoke-gold text-xs font-mono uppercase text-center">
              ✅ Journey Resumed
            </div>
          )}

          {/* ETA Card */}
          {trackingInfo.eta_minutes != null && (
            <div className="mt-1 flex items-center justify-between px-3 py-2 bg-bespoke-black/80 border border-bespoke-border rounded text-xs">
              <span className="text-bespoke-dim font-mono uppercase tracking-wider text-[10px]">ETA</span>
              <span className="font-medium font-mono text-bespoke-gold">
                {trackingInfo.eta_minutes < 1 && (trackingInfo.distance_remaining_km ?? 999) < 0.1
                  ? '✅ Arrived'
                  : trackingInfo.eta_minutes < 60
                  ? `${Math.round(trackingInfo.eta_minutes)} min`
                  : `${Math.floor(trackingInfo.eta_minutes / 60)}h ${Math.round(trackingInfo.eta_minutes % 60)}m`}
              </span>
              {trackingInfo.distance_remaining_km != null && trackingInfo.distance_remaining_km >= 0.1 && (
                <span className="text-bespoke-dim font-mono text-[10px]">
                  {trackingInfo.distance_remaining_km.toFixed(1)} km remaining
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
