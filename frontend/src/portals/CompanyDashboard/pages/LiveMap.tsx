import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  Navigation,
  Filter,
  Radio,
  Route,
  Car,
  X,
  RefreshCw,
  Clock,
  ArrowRight,
  Gauge,
  AlertTriangle,
  Coffee,
  Wrench,
  ExternalLink,
  Play,
  Pause,
} from 'lucide-react';
import { dashboardApi, journeysApi, locationApi, trackingApi } from '../../../services/api';
import {
  ActiveJourneyTelemetry,
  ActiveVehicleTelemetry,
  TripAlert,
  WebSocketMessage,
} from '../../../types';
import { FleetMap, SelectedTransitInfo } from '../../../components/map/FleetMap';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { useAuthStore } from '../../../store/authStore';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export const LiveMap: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryJourneyId = searchParams.get('journeyId');

  const [vehicles, setVehicles] = useState<ActiveVehicleTelemetry[]>([]);
  const [activeJourneys, setActiveJourneys] = useState<ActiveJourneyTelemetry[]>([]);
  const [recentEvents, setRecentEvents] = useState<TripAlert[]>([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('fleet_dismissed_alerts');
      return stored ? new Set(JSON.parse(stored)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedTransit, setSelectedTransit] = useState<SelectedTransitInfo | null>(null);
  const [journeyPath, setJourneyPath] = useState<[number, number][]>([]);
  const [activeTab, setActiveTab] = useState<'transits' | 'vehicles'>('transits');
  const [search, setSearch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [historyPings, setHistoryPings] = useState<any[]>([]);
  const { token } = useAuthStore();

  const selectedTransitRef = useRef<SelectedTransitInfo | null>(null);
  selectedTransitRef.current = selectedTransit;

  // Select a transit and load its full GPS breadcrumb path
  const handleSelectTransit = useCallback(async (transit: ActiveJourneyTelemetry | any) => {
    const jId = transit.journey_id || transit.id;
    setSelectedTransit({
      id: jId,
      journey_id: jId,
      vehicle_id: transit.vehicle_id,
      origin_name: transit.origin_name,
      origin_lat: transit.origin_lat,
      origin_lng: transit.origin_lng,
      destination_name: transit.destination_name,
      destination_lat: transit.destination_lat,
      destination_lng: transit.destination_lng,
      vehicle_registration: transit.vehicle_registration,
      driver_name: transit.driver_name,
      status: transit.status,
      total_distance_km: transit.total_distance_km,
      latest_event_type: transit.latest_event_type,
      latest_speed: transit.latest_location?.speed,
    });
    setSelectedVehicleId(transit.vehicle_id);

    try {
      const history = await locationApi.getHistory(jId);
      if (history && history.length > 0) {
        const coords = history.map((loc: any) => [loc.latitude, loc.longitude] as [number, number]);
        setJourneyPath(coords);
      } else {
        setJourneyPath([]);
      }
    } catch (err) {
      console.warn('Could not load transit path history:', err);
      setJourneyPath([]);
    }
  }, []);

  const dismissedAlertIdsRef = useRef(dismissedAlertIds);
  dismissedAlertIdsRef.current = dismissedAlertIds;

  const handleDismissAlert = useCallback((id: string) => {
    setDismissedAlertIds((prev) => {
      const updated = new Set(prev);
      updated.add(id);
      try {
        localStorage.setItem('fleet_dismissed_alerts', JSON.stringify([...updated]));
      } catch {}
      return updated;
    });
    setRecentEvents((prev) => prev.filter((ev) => ev.id !== id));
    dashboardApi.dismissEvent(id).catch((err) => {
      console.warn('Failed to dismiss alert on server:', err);
    });
  }, []);

  // Load telemetry data from backend with multi-container self-healing sync
  const loadFleetData = useCallback(async () => {
    try {
      const [vData, jData, eData] = await Promise.all([
        dashboardApi.getActiveVehicles(),
        dashboardApi.getActiveJourneys(),
        dashboardApi.getRecentEvents().catch(() => [] as TripAlert[]),
      ]);

      const resolvedJourneys = [...jData];
      const dismissed = dismissedAlertIdsRef.current;
      const filteredEvents = (eData || []).filter((ev) => !dismissed.has(ev.id));

      setVehicles(vData);
      setActiveJourneys(resolvedJourneys);
      setRecentEvents(filteredEvents);

      // If no active journeys exist, clear any active selections
      const current = selectedTransitRef.current;
      if (resolvedJourneys.length === 0) {
        setSelectedTransit(null);
        setSelectedVehicleId(null);
        setJourneyPath([]);
      } else if (current && (current.journey_id || current.id)) {
        const jId = current.journey_id || current.id!;
        const history = await locationApi.getHistory(jId);
        if (history && history.length > 0) {
          const coords = history.map((loc: any) => [loc.latitude, loc.longitude] as [number, number]);
          setJourneyPath(coords);
        }
      } else if (!current && resolvedJourneys.length > 0) {
        // Auto-select first active transit so map displays route and vehicle marker immediately
        handleSelectTransit(resolvedJourneys[0]);
      }
    } catch (e) {
      console.error('Failed to load live fleet data:', e);
    }
  }, [handleSelectTransit]);

  // Quick manual importer for tracking links/tokens from remote phones
  const handlePromptImportToken = async () => {
    const raw = window.prompt('Enter or paste Public Tracking Link / Token:');
    if (!raw) return;
    const cleanToken = raw.includes('/track/') ? raw.split('/track/')[1].split('?')[0].trim() : raw.trim();
    if (!cleanToken) return;
    try {
      setIsRefreshing(true);
      const info = await trackingApi.getInfo(cleanToken);
      localStorage.setItem('fleet_active_token', cleanToken);
      await loadFleetData();
      if (info) {
        setSelectedTransit({
          id: info.journey_id,
          journey_id: info.journey_id,
          vehicle_id: info.vehicle_id,
          origin_name: info.origin_name,
          origin_lat: info.origin_lat,
          origin_lng: info.origin_lng,
          destination_name: info.destination_name,
          destination_lat: info.destination_lat,
          destination_lng: info.destination_lng,
          vehicle_registration: info.vehicle_registration,
          driver_name: info.driver_name,
          status: info.status,
          total_distance_km: 0,
          latest_event_type: null,
          latest_speed: info.latest_location?.speed || 0,
        });
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Could not resolve tracking link. Ensure it is active.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle URL query parameter journey selection (e.g. from ActiveJourneys or History page)
  useEffect(() => {
    if (queryJourneyId) {
      journeysApi
        .get(queryJourneyId)
        .then(async (j) => {
          setSelectedTransit({
            id: j.id,
            journey_id: j.id,
            vehicle_id: j.vehicle_id,
            origin_name: j.origin_name,
            origin_lat: j.origin_lat,
            origin_lng: j.origin_lng,
            destination_name: j.destination_name,
            destination_lat: j.destination_lat,
            destination_lng: j.destination_lng,
            vehicle_registration: j.vehicle_registration,
            driver_name: j.driver_name,
            status: j.status,
            total_distance_km: j.total_distance_km,
          });
          setSelectedVehicleId(j.vehicle_id);
          setActiveTab('transits');

          const history = await locationApi.getHistory(j.id);
          if (history && history.length > 0) {
            setJourneyPath(history.map((loc: any) => [loc.latitude, loc.longitude] as [number, number]));
          }
        })
        .catch((e) => console.error('Failed to resolve journey from query param:', e));
    }
  }, [queryJourneyId]);


  const handleClearTransit = useCallback(() => {
    setSelectedTransit(null);
    setSelectedVehicleId(null);
    setJourneyPath([]);
    setIsReplaying(false);
    setIsPlaying(false);
    setPlaybackIndex(0);
    if (queryJourneyId) {
      setSearchParams({});
    }
  }, [queryJourneyId, setSearchParams]);

  // Traccar-inspired Replay interval runner
  useEffect(() => {
    let timer: any = null;
    if (isReplaying && isPlaying && historyPings.length > 0) {
      const intervalMs = Math.max(150, Math.round(900 / playbackSpeed));
      timer = setInterval(() => {
        setPlaybackIndex((prev) => {
          if (prev >= historyPings.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isReplaying, isPlaying, historyPings.length, playbackSpeed]);

  // Trigger auto-replay if URL has ?replay=true
  useEffect(() => {
    if (queryJourneyId && searchParams.get('replay') === 'true') {
      locationApi.getHistory(queryJourneyId).then((history) => {
        if (history && history.length > 0) {
          setHistoryPings(history);
          setPlaybackIndex(0);
          setIsReplaying(true);
          setIsPlaying(true);
        }
      });
    }
  }, [queryJourneyId, searchParams]);

  const handleStartReplay = useCallback(async () => {
    const jId = selectedTransit?.journey_id || selectedTransit?.id;
    if (!jId) return;
    try {
      const history = await locationApi.getHistory(jId);
      if (history && history.length > 0) {
        setHistoryPings(history);
        setPlaybackIndex(0);
        setIsReplaying(true);
        setIsPlaying(true);
      } else {
        alert('No GPS points recorded for this journey yet.');
      }
    } catch (e) {
      console.warn('Could not load history for replay:', e);
    }
  }, [selectedTransit]);

  const handleStopReplay = useCallback(() => {
    setIsReplaying(false);
    setIsPlaying(false);
    setPlaybackIndex(0);
  }, []);

  const currentReplayPoint = useMemo(() => {
    if (!isReplaying || !historyPings[playbackIndex]) return null;
    const p = historyPings[playbackIndex];
    return {
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed || 0,
      heading: p.heading || 0,
      recorded_at: p.recorded_at || p.timestamp,
      accuracy: p.accuracy,
    };
  }, [isReplaying, historyPings, playbackIndex]);

  // Core handler for single location pings (both direct WebSocket and coalesced envelopes)
  const processLocationUpdate = useCallback(
    (update: any) => {
      const vId = update.vehicle_id || update.device_id || update.id;
      const jId = update.journey_id;
      const lat = update.latitude;
      const lng = update.longitude;
      const speed = update.speed ?? 0;
      const heading = update.heading ?? update.course ?? 0;
      const recAt =
        update.recorded_at ||
        update.timestamp ||
        update.device_time ||
        update.server_time ||
        new Date().toISOString();
      const accuracy = update.accuracy || 0;

      if (lat == null || lng == null) return;

      // 1. Update vehicle position in state
      let foundVehicle = false;
      setVehicles((prev) =>
        prev.map((v) => {
          if (
            (vId && (v.vehicle_id === vId || (v as any).id === vId)) ||
            (jId && v.current_journey_id === jId)
          ) {
            foundVehicle = true;
            return {
              ...v,
              latest_latitude: lat,
              latest_longitude: lng,
              latest_speed: speed,
              latest_heading: heading,
              latest_recorded_at: recAt,
              status: 'IN_TRANSIT',
            };
          }
          return v;
        })
      );

      // 2. Update active journeys in state
      let foundJourney = false;
      setActiveJourneys((prev) =>
        prev.map((j) => {
          if (
            (jId && (j.journey_id === jId || (j as any).id === jId)) ||
            (vId && j.vehicle_id === vId)
          ) {
            foundJourney = true;
            return {
              ...j,
              latest_location: {
                latitude: lat,
                longitude: lng,
                speed: speed,
                heading: heading,
                accuracy: accuracy,
                timestamp: recAt,
              },
            };
          }
          return j;
        })
      );

      // 3. Update polyline path and speed if this transit is currently selected
      const current = selectedTransitRef.current;
      if (
        current &&
        ((jId && (current.journey_id === jId || (current as any).id === jId)) ||
          (vId && (current as any).vehicle_id === vId))
      ) {
        setSelectedTransit((prev) => (prev ? { ...prev, latest_speed: speed } : prev));
        setJourneyPath((prev) => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (Math.abs(last[0] - lat) < 0.00001 && Math.abs(last[1] - lng) < 0.00001) {
              return prev;
            }
          }
          return [...prev, [lat, lng]];
        });
      }

      // If newly discovered vehicle or journey arrived via WS, refresh full fleet list
      if (!foundVehicle || !foundJourney) {
        loadFleetData();
      }
    },
    [loadFleetData]
  );

  // Handle incoming real-time WebSocket vehicle & journey telemetry
  const handleWebSocketMessage = useCallback(
    (msg: WebSocketMessage) => {
      if (!msg) return;

      if (msg.type === 'ENVELOPE') {
        const env = msg as any;
        if (env.positions && Array.isArray(env.positions)) {
          for (const pos of env.positions) {
            processLocationUpdate(pos);
          }
        }
        if (env.events && Array.isArray(env.events)) {
          loadFleetData();
        }
      } else if (msg.type === 'VEHICLE_MOVED' || msg.type === 'LOCATION_UPDATE') {
        processLocationUpdate(msg);
      } else if (msg.type === 'JOURNEY_FINISHED' || msg.type === 'JOURNEY_COMPLETED') {
        const finishedId = (msg as any).journey_id || (msg as any).id;
        setActiveJourneys((prev) => prev.filter((j) => j.journey_id !== finishedId && (j as any).id !== finishedId));
        setVehicles((prev) =>
          prev.map((v) =>
            v.current_journey_id === finishedId
              ? { ...v, status: 'AVAILABLE', current_journey_id: null }
              : v
          )
        );
        if (
          selectedTransitRef.current &&
          (selectedTransitRef.current.journey_id === finishedId || selectedTransitRef.current.id === finishedId)
        ) {
          if (!queryJourneyId) {
            setSelectedTransit(null);
            setSelectedVehicleId(null);
            setJourneyPath([]);
          }
        }
        loadFleetData();
      } else if (msg.type === 'TRIP_EVENT') {
        const evId = (msg as any).id;
        if (evId && dismissedAlertIdsRef.current.has(evId)) {
          return;
        }
        loadFleetData();
      } else if (msg.type === 'JOURNEY_STARTED') {
        loadFleetData();
      }
    },
    [processLocationUpdate, loadFleetData, queryJourneyId]
  );

  // Connect to live fleet WebSocket
  const wsUrl = token ? `/ws/live-fleet?token=${token}` : null;
  const { isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
    onReconnect: loadFleetData,
  });

  // REST polling: only poll frequently (10s) while WebSocket is disconnected; otherwise 60s safety refresh
  useEffect(() => {
    loadFleetData();
    const pollInterval = isConnected ? 60000 : 10000;
    const interval = setInterval(loadFleetData, pollInterval);
    return () => clearInterval(interval);
  }, [loadFleetData, isConnected]);

  // Most critical unread incident across fleet (SOS takes highest precedence)
  const criticalAlert = useMemo(() => {
    return recentEvents.find(
      (ev) =>
        !dismissedAlertIds.has(ev.id) &&
        (ev.event_type === 'SOS' || ev.event_type === 'BREAKDOWN' || ev.event_type === 'BREAK_START')
    );
  }, [recentEvents, dismissedAlertIds]);

  const filteredVehicles = vehicles.filter(
    (v) =>
      v.registration_number.toLowerCase().includes(search.toLowerCase()) ||
      v.model.toLowerCase().includes(search.toLowerCase()) ||
      (v.assigned_driver_name && v.assigned_driver_name.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredJourneys = activeJourneys.filter(
    (j) =>
      j.vehicle_registration.toLowerCase().includes(search.toLowerCase()) ||
      j.driver_name.toLowerCase().includes(search.toLowerCase()) ||
      j.origin_name.toLowerCase().includes(search.toLowerCase()) ||
      j.destination_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] relative overflow-hidden -m-8">
      {/* Full-screen Leaflet Map */}
      <div className="flex-1 h-full relative">
        <FleetMap
          vehicles={vehicles}
          selectedVehicleId={selectedVehicleId}
          onSelectVehicle={(id) => {
            setSelectedVehicleId(id);
            const matchingJourney = activeJourneys.find((j) => j.vehicle_id === id);
            if (matchingJourney) {
              handleSelectTransit(matchingJourney);
            }
          }}
          selectedTransit={selectedTransit}
          journeyPath={journeyPath}
          replayPoint={currentReplayPoint}
        />

        {/* 1. Real-time Clickable Active Trips Bar across top of map */}
        <div className="absolute top-4 left-4 right-96 z-20 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none pointer-events-auto">
          {activeJourneys.length === 0 ? (
            <div className="px-4 py-2 bg-white/90 border border-white/80 rounded-full text-xs font-semibold text-zinc-700 backdrop-blur-xl shadow-lg flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-400" />
              <span>No active dispatches — All units standby</span>
            </div>
          ) : (
            activeJourneys.map((j) => {
              const isSelected = selectedTransit?.journey_id === j.journey_id || selectedTransit?.id === j.journey_id;
              const isSos = j.latest_event_type === 'SOS';
              const isBreakdown = j.latest_event_type === 'BREAKDOWN';
              const isBreak = j.latest_event_type === 'BREAK_START';

              return (
                <button
                  key={j.journey_id}
                  onClick={() => handleSelectTransit(j)}
                  className={`flex-shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all shadow-md backdrop-blur-xl cursor-pointer ${
                    isSelected
                      ? 'bg-[#0071E3] border-blue-400 text-white shadow-blue-500/25 scale-105'
                      : isSos
                      ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse'
                      : isBreakdown
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : isBreak
                      ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
                      : 'bg-white/90 border-white/80 text-zinc-700 hover:bg-white hover:text-zinc-900'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSos
                        ? 'bg-rose-500 animate-ping'
                        : isBreakdown
                        ? 'bg-amber-500 animate-bounce'
                        : isBreak
                        ? 'bg-yellow-500'
                        : isSelected
                        ? 'bg-white'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <span className="font-bold tracking-tight font-mono">{j.vehicle_registration}</span>
                  <span className="text-[11px] opacity-80 truncate max-w-[130px]" title={`${j.origin_name} → ${j.destination_name}`}>
                    {j.origin_name} &rarr; {j.destination_name}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-black/5 text-zinc-700'}`}>
                    {j.latest_location?.speed || 0} km/h
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 2. Critical Incident Alert Banner (SOS / Breakdown / Break) */}
        {criticalAlert && (
          <div className="absolute top-16 left-4 right-96 z-20 animate-in fade-in slide-in-from-top-3 duration-300 pointer-events-auto">
            <div
              className={`p-3 rounded-2xl border shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3 ${
                criticalAlert.event_type === 'SOS'
                  ? 'bg-rose-950/95 border-rose-500 text-rose-200 animate-pulse ring-2 ring-rose-500/50'
                  : criticalAlert.event_type === 'BREAKDOWN'
                  ? 'bg-amber-950/95 border-amber-500 text-amber-200 ring-1 ring-amber-500/50'
                  : 'bg-yellow-950/95 border-yellow-500 text-yellow-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {criticalAlert.event_type === 'SOS' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-400 animate-bounce shrink-0" />
                ) : criticalAlert.event_type === 'BREAKDOWN' ? (
                  <Wrench className="w-5 h-5 text-amber-400 shrink-0" />
                ) : (
                  <Coffee className="w-5 h-5 text-yellow-400 shrink-0" />
                )}
                <div className="text-xs">
                  <strong className="uppercase font-black block tracking-wider">
                    {criticalAlert.event_type === 'SOS'
                      ? '🚨 CRITICAL SOS EMERGENCY BROADCAST'
                      : criticalAlert.event_type === 'BREAKDOWN'
                      ? '⚠️ DRIVER REPORTED VEHICLE BREAKDOWN'
                      : '☕ DRIVER ON REST BREAK'}
                  </strong>
                  <span>
                    Unit <strong>{criticalAlert.vehicle_registration || 'Vehicle'}</strong> • Driver{' '}
                    <strong>{criticalAlert.driver_name || 'Driver'}</strong>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const matchingJourney = activeJourneys.find((j) => j.journey_id === criticalAlert.journey_id);
                    if (matchingJourney) {
                      handleSelectTransit(matchingJourney);
                    }
                  }}
                  className="px-3 py-1 bg-white text-slate-900 font-bold rounded-xl text-xs hover:bg-slate-200 shadow-md flex items-center gap-1 cursor-pointer transition"
                >
                  <span>Locate Trip</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissAlert(criticalAlert.id)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                  title="Dismiss alert banner"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. Selected Transit Active Floating HUD */}
        {selectedTransit && (
          <div
            className={`absolute left-4 z-20 max-w-sm w-full animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-auto ${
              criticalAlert ? 'top-32' : 'top-16'
            }`}
          >
            <div className="bg-white/90 border border-white/80 backdrop-blur-2xl p-4 rounded-3xl shadow-2xl space-y-3 text-zinc-900">
              <div className="flex items-center justify-between border-b border-black/[0.05] pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0071E3] border border-blue-200/50 flex items-center justify-center font-bold">
                    <Route className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 font-mono tracking-tight">
                      {selectedTransit.vehicle_registration || 'TRANSIT'}
                    </h4>
                    <p className="text-[11px] text-zinc-700 font-semibold">Driver: {selectedTransit.driver_name || 'Assigned'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTransit.latest_event_type === 'SOS' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 animate-pulse">
                      🚨 SOS ACTIVE
                    </span>
                  ) : selectedTransit.latest_event_type === 'BREAKDOWN' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                      ⚠️ BREAKDOWN
                    </span>
                  ) : selectedTransit.latest_event_type === 'BREAK_START' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">
                      ☕ ON BREAK
                    </span>
                  ) : selectedTransit.status === 'COMPLETED' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
                      COMPLETED
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 flex items-center gap-1 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                      LIVE TRANSIT
                    </span>
                  )}
                  <button
                    onClick={handleClearTransit}
                    className="p-1 rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
                    title="Close Transit View"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Origin -> Destination Route Display */}
              <div className="grid grid-cols-2 gap-2 bg-zinc-50/80 p-2.5 rounded-2xl border border-black/[0.04] text-xs">
                <div>
                  <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Origin Start
                  </span>
                  <p className="font-semibold text-zinc-800 truncate">{selectedTransit.origin_name}</p>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider block flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Target Goal
                  </span>
                  <p className="font-semibold text-zinc-800 truncate">{selectedTransit.destination_name}</p>
                </div>
              </div>

              {/* Real-time stats footer & Replay trigger */}
              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-0.5 border-t border-black/[0.05]">
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#0071E3]" />
                  <span>
                    GPS Breadcrumbs:{' '}
                    <strong className="text-zinc-900 font-mono">{journeyPath.length} pings</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-900 font-mono font-bold">
                    {selectedTransit.latest_speed || 0} km/h
                  </span>
                  <button
                    type="button"
                    onClick={handleStartReplay}
                    className="flex items-center gap-1 px-3 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200/80 rounded-full text-[10px] font-bold uppercase transition shadow-sm cursor-pointer"
                    title="Route playback"
                  >
                    <Play className="w-3 h-3 text-[#0071E3]" />
                    <span>Replay</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Traccar-style Interactive Trip Playback Bar */}
        {isReplaying && historyPings.length > 0 && (
          <div className="absolute bottom-5 left-4 right-96 bg-bespoke-surface/95 border border-bespoke-border backdrop-blur-xl p-4 rounded-xl shadow-2xl z-20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-bespoke-gold animate-pulse" />
                <span className="text-xs font-mono uppercase tracking-[0.1em] text-bespoke-offwhite">
                  Route Replay: {selectedTransit?.vehicle_registration || 'Vehicle'}
                </span>
                <span className="text-[10px] bg-bespoke-black text-bespoke-champagne px-2 py-0.5 rounded border border-bespoke-border font-mono">
                  Point {playbackIndex + 1} of {historyPings.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Speed Multipliers */}
                <div className="flex bg-bespoke-black p-0.5 rounded border border-bespoke-border text-[10px] font-mono">
                  {[1, 2, 5].map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlaybackSpeed(s)}
                      className={`px-2 py-0.5 rounded transition ${
                        playbackSpeed === s
                          ? 'bg-bespoke-gold text-bespoke-black font-semibold shadow'
                          : 'text-bespoke-champagne/60 hover:text-white'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleStopReplay}
                  className="text-xs text-bespoke-champagne/60 hover:text-bespoke-error px-2 py-1 rounded hover:bg-bespoke-card transition font-mono uppercase tracking-wider cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Scrubber slider */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 bg-bespoke-gold hover:bg-bespoke-goldHover text-bespoke-black rounded shadow-lg transition flex-shrink-0 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(historyPings.length - 1, 0)}
                value={playbackIndex}
                onChange={(e) => {
                  setPlaybackIndex(Number(e.target.value));
                  setIsPlaying(false);
                }}
                className="w-full accent-[#cb886c] cursor-pointer h-1.5 bg-bespoke-border rounded appearance-none"
              />
            </div>

            {/* Telemetry metrics bar */}
            <div className="grid grid-cols-4 gap-2 text-center text-xs bg-bespoke-dark/80 p-2 rounded border border-bespoke-border">
              <div>
                <span className="text-[9px] uppercase tracking-wider font-mono text-bespoke-dim block">Speed</span>
                <span className="font-mono font-medium text-bespoke-gold">
                  {Math.round(historyPings[playbackIndex]?.speed || 0)} km/h
                </span>
              </div>
              <div>
                <span className="text-[9px] uppercase tracking-wider font-mono text-bespoke-dim block">Heading</span>
                <span className="font-mono text-bespoke-linen">
                  {Math.round(historyPings[playbackIndex]?.heading || 0)}°
                </span>
              </div>
              <div>
                <span className="text-[9px] uppercase tracking-wider font-mono text-bespoke-dim block">Recorded At</span>
                <span className="font-mono text-bespoke-champagne text-[10px]">
                  {historyPings[playbackIndex]?.recorded_at
                    ? new Date(historyPings[playbackIndex].recorded_at).toLocaleTimeString()
                    : historyPings[playbackIndex]?.timestamp
                    ? new Date(historyPings[playbackIndex].timestamp).toLocaleTimeString()
                    : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-[9px] uppercase tracking-wider font-mono text-bespoke-dim block">Ignition</span>
                <span className={`text-[10px] font-mono ${
                  (historyPings[playbackIndex]?.speed || 0) > 2 ? 'text-bespoke-green' : 'text-bespoke-dim'
                }`}>
                  {(historyPings[playbackIndex]?.speed || 0) > 2 ? '⚡ ON' : 'OFF'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Right Control Panel */}
      <div className="w-88 bg-white/85 border-l border-black/[0.06] backdrop-blur-2xl flex flex-col z-20 shadow-xl text-zinc-900 font-sans">
        <div className="p-4 border-b border-black/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Fleet Dispatch Hub</span>
            </h3>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                isConnected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                  : 'bg-zinc-100 text-zinc-600 border-zinc-200'
              }`}
            >
              {isConnected ? 'LIVE WS' : 'POLLING 10s'}
            </span>
          </div>

          {/* Tab Selector: Active Transits vs All Vehicles */}
          <div className="grid grid-cols-2 gap-1 bg-zinc-200/80 p-1 rounded-2xl text-xs font-semibold">
            <button
              onClick={() => setActiveTab('transits')}
              className={`py-1.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'transits'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Route className="w-3.5 h-3.5" />
              <span>Trips ({activeJourneys.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('vehicles')}
              className={`py-1.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'vehicles'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>Units ({vehicles.length})</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'transits' ? 'Search destination, driver...' : 'Search registration...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-black/[0.04] border border-black/[0.08] rounded-xl text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={handlePromptImportToken}
            className="w-full py-2 px-3 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200/80 rounded-xl text-xs font-semibold text-zinc-800 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#0071E3]" />
            <span>Track Trip by Token</span>
          </button>
        </div>

        {/* List Content: Transits or Units */}
        <div className="flex-1 overflow-y-auto divide-y divide-bespoke-border/60 p-2 space-y-1">
          {activeTab === 'transits' ? (
            filteredJourneys.length === 0 ? (
              <div className="p-8 text-center text-xs text-bespoke-dim font-mono uppercase tracking-wider">
                <Route className="w-6 h-6 text-bespoke-border mx-auto mb-2" />
                <p>No active transits underway.</p>
                <p className="text-[10px] text-bespoke-dim/70 mt-1 font-sans">Start a journey from mobile driver portal to stream live path.</p>
              </div>
            ) : (
              filteredJourneys.map((j) => {
                const isSelected = selectedTransit?.journey_id === j.journey_id || selectedTransit?.id === j.journey_id;
                const isSos = j.latest_event_type === 'SOS';
                const isBreakdown = j.latest_event_type === 'BREAKDOWN';
                const isBreak = j.latest_event_type === 'BREAK_START';

                return (
                  <div
                    key={j.journey_id}
                    onClick={() => handleSelectTransit(j)}
                    className={`p-3 rounded cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-bespoke-card border border-bespoke-gold/60 shadow-lg'
                        : isSos
                        ? 'bg-bespoke-error/20 border border-bespoke-error/60 hover:bg-bespoke-error/30'
                        : isBreakdown
                        ? 'bg-amber-950/40 border border-amber-800/70 hover:bg-amber-950/60'
                        : 'hover:bg-bespoke-card/50 border border-transparent bg-bespoke-dark/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-sm text-bespoke-offwhite font-medium tracking-wider">{j.vehicle_registration}</span>
                      {isSos ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bespoke-error/20 text-bespoke-linen border border-bespoke-error animate-pulse">
                          🚨 SOS ACTIVE
                        </span>
                      ) : isBreakdown ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600">
                          ⚠️ BREAKDOWN
                        </span>
                      ) : isBreak ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-yellow-950 text-yellow-300 border border-yellow-600">
                          ☕ ON BREAK
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bespoke-gold/10 text-bespoke-gold border border-bespoke-gold/30 uppercase flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-bespoke-gold animate-pulse" />
                          In Transit
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 mb-2 text-xs">
                      <div className="flex items-center gap-1.5 text-bespoke-champagne truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-bespoke-gold shrink-0" />
                        <span className="truncate">{j.origin_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-bespoke-offwhite font-medium truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-bespoke-champagne shrink-0" />
                        <span className="truncate">{j.destination_name}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-bespoke-champagne/70 pt-1 border-t border-bespoke-border">
                      <span>Driver: <strong className="text-bespoke-linen font-normal">{j.driver_name}</strong></span>
                      <span className="font-mono text-bespoke-gold font-medium">
                        {j.latest_location?.speed || 0} km/h
                      </span>
                    </div>

                    {isSelected && (
                      <div className="mt-2 pt-2 border-t border-bespoke-border text-[10px] text-bespoke-gold font-mono uppercase tracking-wider flex items-center justify-between">
                        <span>Active Trajectory</span>
                        <ArrowRight className="w-3 h-3 animate-pulse" />
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            filteredVehicles.map((v) => {
              const isSelected = v.vehicle_id === selectedVehicleId;
              return (
                <div
                  key={v.vehicle_id}
                  onClick={() => {
                    setSelectedVehicleId(v.vehicle_id);
                    const matchingJourney = activeJourneys.find((j) => j.vehicle_id === v.vehicle_id);
                    if (matchingJourney) {
                      handleSelectTransit(matchingJourney);
                    }
                  }}
                  className={`p-3 rounded cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-bespoke-card border border-bespoke-gold/60'
                      : 'hover:bg-bespoke-card/50 border border-transparent bg-bespoke-dark/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm text-zinc-900 font-bold tracking-tight">{v.registration_number}</span>
                    <StatusBadge status={v.status} size="sm" />
                  </div>
                  <p className="text-xs text-zinc-600 font-medium mb-1">{v.model}</p>
                  {v.origin_name && v.destination_name && (
                    <div className="text-[11px] text-zinc-800 flex items-center gap-1.5 my-1.5 truncate bg-black/[0.03] p-2 rounded-xl border border-black/[0.05]">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span className="truncate text-zinc-900 font-bold">{v.origin_name}</span>
                      <span className="text-zinc-500 font-bold mx-0.5">&rarr;</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate text-zinc-900 font-bold">{v.destination_name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-zinc-700 font-medium">
                    <span>Driver: <strong className="text-zinc-900">{v.assigned_driver_name || 'None'}</strong></span>
                    <span className="font-mono text-blue-600 font-bold">{v.latest_speed || 0} km/h</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
