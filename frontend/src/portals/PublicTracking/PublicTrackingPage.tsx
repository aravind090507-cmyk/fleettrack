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

  // High-frequency 2.5s auto-polling fallback (guarantees real-time GPS sync even without WebSockets)
  useEffect(() => {
    if (isEnded || !token) return;
    const interval = setInterval(() => {
      fetchLiveState();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchLiveState, isEnded, token]);

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
      setRouteHistory((prev) => [...prev, [msg.latitude, msg.longitude]]);
    } else if (msg.type === 'JOURNEY_COMPLETED') {
      setIsEnded(true);
    }
  }, []);

  const wsUrl = token ? `/ws/track/${token}` : null;
  const { isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
    onJourneyCompleted: () => setIsEnded(true),
  });

  if (isLoading) {
    return <LoadingSpinner label="Resolving temporary tracking link..." fullScreen />;
  }

  // If the journey has concluded or token expired
  if (isEnded) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center select-none">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-rose-950/80 border border-rose-800 text-rose-400 flex items-center justify-center mx-auto shadow-xl shadow-rose-950">
            <AlertOctagon className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase">
              THIS JOURNEY HAS ENDED
            </h1>
            <p className="text-sm text-slate-400 mt-2 font-medium">
              Tracking access is no longer available.
            </p>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-slate-500 leading-relaxed">
            In accordance with corporate security policy, all temporary journey links are permanently invalidated (HTTP
            410 Gone) immediately upon destination arrival.
          </div>

          <div className="pt-2 text-[11px] text-slate-600 font-semibold tracking-wider uppercase">
            FleetTrack Enterprise Security Shield
          </div>
        </div>
      </div>
    );
  }

  // If temporary connection issue while trackingInfo is not yet loaded
  if (!trackingInfo) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center select-none">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-950/80 border border-amber-800 text-amber-400 flex items-center justify-center mx-auto shadow-xl">
            <Radio className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-white">Connecting to Fleet Dispatch</h2>
          <p className="text-xs text-slate-400">
            {networkError || 'Establishing secure telemetry channel with driver unit...'}
          </p>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchLiveState();
            }}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const isSignalLost = secondsSinceLastPing > 15;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden relative">
      {/* Top Floating Header */}
      <header className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
        <div className="bg-slate-900/90 border border-slate-800/80 backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl pointer-events-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-md">
            <Radio className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              {trackingInfo.vehicle_registration} ({trackingInfo.vehicle_type})
            </h2>
            <p className="text-[11px] text-slate-400">Driver: {trackingInfo.driver_name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {isSignalLost ? (
            <div className="bg-amber-950/90 border border-amber-800/80 backdrop-blur-md px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="text-[10px] font-bold tracking-wide uppercase text-amber-400">
                SIGNAL LOST ({secondsSinceLastPing}s ago)
              </span>
            </div>
          ) : (
            <div className="bg-slate-900/90 border border-slate-800/80 backdrop-blur-md px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[10px] font-bold tracking-wide uppercase text-emerald-400">
                {isConnected ? 'LIVE WEBSOCKET' : 'REAL-TIME SYNC (2.5s)'}
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
        <div className="bg-slate-900/95 border border-slate-800/90 backdrop-blur-xl p-4 rounded-3xl shadow-2xl space-y-3">
          <div className="grid grid-cols-2 gap-4 border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] text-emerald-400 font-bold uppercase block flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Origin Start
              </span>
              <p className="text-xs font-bold text-white truncate">{trackingInfo.origin_name}</p>
            </div>
            <div>
              <span className="text-[10px] text-rose-400 font-bold uppercase block flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                Target Destination
              </span>
              <p className="text-xs font-bold text-slate-100 truncate">{trackingInfo.destination_name}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Gauge className="w-4 h-4 text-emerald-400" />
              <span>
                Current Speed: <strong className="font-mono text-white">{currentLocation?.speed || 0} km/h</strong>
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Encrypted Stream</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
