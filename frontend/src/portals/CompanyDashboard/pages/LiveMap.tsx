import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Navigation, Filter, Radio, Route, Car, X, RefreshCw, Clock, ArrowRight, Gauge } from 'lucide-react';
import { dashboardApi, journeysApi, locationApi } from '../../../services/api';
import { ActiveJourneyTelemetry, ActiveVehicleTelemetry, WebSocketMessage } from '../../../types';
import { FleetMap, SelectedTransitInfo } from '../../../components/map/FleetMap';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { useAuthStore } from '../../../store/authStore';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export const LiveMap: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryJourneyId = searchParams.get('journeyId');

  const [vehicles, setVehicles] = useState<ActiveVehicleTelemetry[]>([]);
  const [activeJourneys, setActiveJourneys] = useState<ActiveJourneyTelemetry[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedTransit, setSelectedTransit] = useState<SelectedTransitInfo | null>(null);
  const [journeyPath, setJourneyPath] = useState<[number, number][]>([]);
  const [activeTab, setActiveTab] = useState<'transits' | 'vehicles'>('transits');
  const [search, setSearch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const { token } = useAuthStore();

  const selectedTransitRef = useRef<SelectedTransitInfo | null>(null);
  selectedTransitRef.current = selectedTransit;

  // Load telemetry data from backend
  const loadFleetData = useCallback(async () => {
    try {
      const [vData, jData] = await Promise.all([
        dashboardApi.getActiveVehicles(),
        dashboardApi.getActiveJourneys(),
      ]);
      setVehicles(vData);
      setActiveJourneys(jData);

      // If a transit is currently selected, update its path
      const current = selectedTransitRef.current;
      if (current && (current.journey_id || current.id)) {
        const jId = current.journey_id || current.id!;
        const history = await locationApi.getHistory(jId);
        if (history && history.length > 0) {
          const coords = history.map((loc: any) => [loc.latitude, loc.longitude] as [number, number]);
          setJourneyPath(coords);
        }
      }
    } catch (e) {
      console.error('Failed to load live fleet data:', e);
    }
  }, []);

  // Periodic fast auto-refresh every 2.5 seconds (ensures rock-solid sync even without WS)
  useEffect(() => {
    loadFleetData();
    const interval = setInterval(loadFleetData, 2500);
    return () => clearInterval(interval);
  }, [loadFleetData]);

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

  const handleClearTransit = useCallback(() => {
    setSelectedTransit(null);
    setSelectedVehicleId(null);
    setJourneyPath([]);
    if (queryJourneyId) {
      setSearchParams({});
    }
  }, [queryJourneyId, setSearchParams]);

  // Handle incoming real-time WebSocket vehicle & journey telemetry
  const handleWebSocketMessage = useCallback(
    (msg: WebSocketMessage) => {
      if (msg.type === 'VEHICLE_MOVED' || msg.type === 'LOCATION_UPDATE') {
        const vId = msg.vehicle_id;
        const jId = msg.journey_id;

        // 1. Update vehicle position in state
        setVehicles((prev) =>
          prev.map((v) => {
            if (v.vehicle_id === vId) {
              return {
                ...v,
                latest_latitude: msg.latitude,
                latest_longitude: msg.longitude,
                latest_speed: msg.speed,
                latest_heading: msg.heading,
                latest_recorded_at: msg.recorded_at,
                status: 'IN_TRANSIT',
              };
            }
            return v;
          })
        );

        // 2. Update active journeys in state
        setActiveJourneys((prev) =>
          prev.map((j) => {
            if (j.journey_id === jId || j.vehicle_id === vId) {
              return {
                ...j,
                latest_location: {
                  latitude: msg.latitude,
                  longitude: msg.longitude,
                  speed: msg.speed,
                  heading: msg.heading,
                  accuracy: msg.accuracy || 0,
                  timestamp: msg.recorded_at,
                },
              };
            }
            return j;
          })
        );

        // 3. If currently viewing this transit, immediately append point to polyline
        const current = selectedTransitRef.current;
        if (current && (current.journey_id === jId || (current as any).vehicle_id === vId)) {
          setJourneyPath((prev) => [...prev, [msg.latitude, msg.longitude]]);
        }
      } else if (msg.type === 'JOURNEY_FINISHED' || msg.type === 'JOURNEY_COMPLETED') {
        loadFleetData();
      }
    },
    [loadFleetData]
  );

  // Connect to live fleet WebSocket
  const wsUrl = token ? `/ws/live-fleet?token=${token}` : null;
  const { isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
  });

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
        />

        {/* Selected Transit Active Floating HUD */}
        {selectedTransit && (
          <div className="absolute top-4 left-4 z-20 max-w-md w-full animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="bg-slate-900/95 border border-emerald-500/40 backdrop-blur-xl p-4 rounded-2xl shadow-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
                    <Route className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white font-mono uppercase tracking-wider">
                      {selectedTransit.vehicle_registration || 'TRANSIT'}
                    </h4>
                    <p className="text-[11px] text-slate-400">Driver: {selectedTransit.driver_name || 'Assigned'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTransit.status === 'COMPLETED' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      COMPLETED TRIP
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      LIVE TRANSIT
                    </span>
                  )}
                  <button
                    onClick={handleClearTransit}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    title="Close Transit View"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Origin -> Destination Route Display */}
              <div className="grid grid-cols-2 gap-3 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs">
                <div>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase block flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Origin Start
                  </span>
                  <p className="font-semibold text-slate-200 truncate">{selectedTransit.origin_name}</p>
                </div>
                <div>
                  <span className="text-[10px] text-rose-400 font-bold uppercase block flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    Target Goal
                  </span>
                  <p className="font-semibold text-slate-200 truncate">{selectedTransit.destination_name}</p>
                </div>
              </div>

              {/* Real-time stats footer */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                <div className="flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    GPS Breadcrumbs:{' '}
                    <strong className="text-white font-mono">{journeyPath.length} recorded pings</strong>
                  </span>
                </div>
                <span className="text-slate-500 font-mono text-[10px]">Auto-refreshing 2s</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Right Control Panel */}
      <div className="w-88 bg-slate-900/95 border-l border-slate-800 backdrop-blur-md flex flex-col z-20 shadow-2xl">
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span>Fleet Dispatch Hub</span>
            </h3>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                isConnected
                  ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                  : 'bg-emerald-950/50 text-emerald-300 border-emerald-700'
              }`}
            >
              {isConnected ? 'LIVE WS' : 'AUTO-POLLING 2s'}
            </span>
          </div>

          {/* Tab Selector: Active Transits vs All Vehicles */}
          <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('transits')}
              className={`py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
                activeTab === 'transits'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Route className="w-3.5 h-3.5" />
              <span>Transits ({activeJourneys.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('vehicles')}
              className={`py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
                activeTab === 'vehicles'
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>Units ({vehicles.length})</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'transits' ? 'Search transit destination, driver...' : 'Search registration, model...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* List Content: Transits or Units */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
          {activeTab === 'transits' ? (
            filteredJourneys.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <Route className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p>No active transits currently underway.</p>
                <p className="text-[11px] text-slate-600 mt-1">Start a journey from the mobile driver app to view live path.</p>
              </div>
            ) : (
              filteredJourneys.map((j) => {
                const isSelected = selectedTransit?.journey_id === j.journey_id || selectedTransit?.id === j.journey_id;
                return (
                  <div
                    key={j.journey_id}
                    onClick={() => handleSelectTransit(j)}
                    className={`p-3 rounded-xl cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-emerald-950/60 border border-emerald-500/80 shadow-lg shadow-emerald-950/50'
                        : 'hover:bg-slate-800/60 border border-transparent bg-slate-950/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-sm text-white font-mono">{j.vehicle_registration}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 uppercase flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        In Transit
                      </span>
                    </div>

                    <div className="space-y-1 mb-2 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-300 truncate">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                        <span className="truncate">{j.origin_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-white font-semibold truncate">
                        <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                        <span className="truncate">{j.destination_name}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <span>Driver: <strong className="text-slate-300">{j.driver_name}</strong></span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {j.latest_location?.speed || 0} km/h
                      </span>
                    </div>

                    {isSelected && (
                      <div className="mt-2 pt-2 border-t border-emerald-900/60 text-[10px] text-emerald-400 font-semibold flex items-center justify-between">
                        <span>Showing Route Path & Pins</span>
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
                  className={`p-3 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-emerald-950/50 border border-emerald-800/80'
                      : 'hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-white font-mono">{v.registration_number}</span>
                    <StatusBadge status={v.status} size="sm" />
                  </div>
                  <p className="text-xs text-slate-400 mb-1">{v.model}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Driver: {v.assigned_driver_name || 'None'}</span>
                    <span className="font-mono text-emerald-400 font-bold">{v.latest_speed || 0} km/h</span>
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
