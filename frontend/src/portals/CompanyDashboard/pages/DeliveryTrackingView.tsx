import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Navigation,
  Truck,
  User,
  Clock,
  Compass,
  Gauge,
  MapPin,
  Activity,
  ShieldCheck,
  Wifi,
  WifiOff,
  ExternalLink,
  Layers,
  Crosshair,
  Maximize2,
  Battery,
  Zap,
  AlertTriangle,
  RefreshCw,
  Route,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { dispatchApi, locationApi, journeysApi, getApiBaseUrl } from '../../../services/api';
import { DeliveryAssignment, LocationPing, LatestLocation, Position, AdaptiveTrackingState } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { getMapTileConfig } from '../../../services/mapConfig';
import { useTelematicsStore } from '../../../store/telematicsStore';
import { useWebSocket } from '../../../hooks/useWebSocket';
import {
  calculateLiveTrackingFreshness,
  haversineMeters,
} from '../../../services/adaptiveTracking';

// Pulse vehicle icon with heading rotation matching Apple FleetTrack aesthetic
function createVehiclePulseIcon(heading: number = 0) {
  const safeHeading = isFinite(heading) ? heading : 0;
  const html = `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div class="apple-radar-wave" style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background-color: rgba(0, 113, 227, 0.35);"></div>
      <div style="position: relative; z-index: 2; transform: rotate(${safeHeading}deg); transition: transform 0.3s ease; width: 34px; height: 34px; border-radius: 50%; background: #0071e3; border: 3px solid #ffffff; box-shadow: 0 8px 20px rgba(0, 113, 227, 0.45); display: flex; align-items: center; justify-content: center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" stroke="none">
          <polygon points="12 2 19 21 12 17 5 21 12 2"/>
        </svg>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'delivery-vehicle-pulse-icon',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

const originIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #1c1c1e; border: 2.5px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.35);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
    </div>
  `,
  className: 'delivery-origin-marker',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const destinationIcon = L.divIcon({
  html: `
    <div style="width: 34px; height: 34px; background: #ff3b30; border: 2.5px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(255,59,48,0.5);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="3 2 19 9 3 16 3 2"/></svg>
    </div>
  `,
  className: 'delivery-dest-marker',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

// Helper component to center or fit bounds on user action
function MapControllerComponent({
  centerOnVehicleTrigger,
  fitRouteTrigger,
  vehicleCoords,
  originCoords,
  destinationCoords,
  breadcrumbs,
}: {
  centerOnVehicleTrigger: number;
  fitRouteTrigger: number;
  vehicleCoords: [number, number] | null;
  originCoords: [number, number];
  destinationCoords: [number, number];
  breadcrumbs: [number, number][];
}) {
  const map = useMap();

  useEffect(() => {
    if (centerOnVehicleTrigger > 0 && vehicleCoords) {
      map.flyTo(vehicleCoords, Math.max(map.getZoom(), 16), { duration: 1.0 });
    }
  }, [centerOnVehicleTrigger, vehicleCoords, map]);

  useEffect(() => {
    if (fitRouteTrigger > 0) {
      const points: [number, number][] = [originCoords, destinationCoords];
      if (vehicleCoords) points.push(vehicleCoords);
      if (breadcrumbs.length > 0) points.push(...breadcrumbs);

      try {
        const bounds = L.latLngBounds(points.map((p) => [p[0], p[1]]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      } catch (e) {
        console.warn('fitBounds error', e);
      }
    }
  }, [fitRouteTrigger, originCoords, destinationCoords, vehicleCoords, breadcrumbs, map]);

  return null;
}

function formatCompassHeading(deg?: number): string {
  if (deg === undefined || deg === null || isNaN(deg)) return '0° (N)';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return `${Math.round(deg)}° (${dirs[idx]})`;
}

interface DeliveryTrackingViewProps {
  assignmentId: string;
  onBack: () => void;
}

export const DeliveryTrackingView: React.FC<DeliveryTrackingViewProps> = ({
  assignmentId,
  onBack,
}) => {
  const [assignment, setAssignment] = useState<DeliveryAssignment | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Live Location & Breadcrumbs
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    accuracy: number;
    timestamp: string;
    adaptive_state?: AdaptiveTrackingState;
    acquisition_interval_sec?: number;
    transmission_interval_sec?: number;
    battery_saving?: boolean;
  } | null>(null);

  const [breadcrumbs, setBreadcrumbs] = useState<[number, number][]>([]);
  const [totalDistanceKm, setTotalDistanceKm] = useState<number>(0);
  const [journeyStartedAt, setJourneyStartedAt] = useState<string | null>(null);

  // Map control trigger counters
  const [centerVehicleCount, setCenterVehicleCount] = useState<number>(0);
  const [fitRouteCount, setFitRouteCount] = useState<number>(0);

  // Countdown timer ticker for live update countdown
  const [, setClockTicker] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTicker((c) => c + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const mapTile = useMemo(() => getMapTileConfig('apple'), []);

  const customerTrackingUrl = useMemo(() => {
    if (!assignment?.tracking_url) return null;
    if (assignment.tracking_url.startsWith('http')) {
      return assignment.tracking_url;
    }
    const cleanPath = assignment.tracking_url.startsWith('/')
      ? assignment.tracking_url
      : `/${assignment.tracking_url}`;
    return `${window.location.origin}${cleanPath}`;
  }, [assignment?.tracking_url]);

  // Fetch Assignment Details & Initial Journey State
  const loadAssignmentData = useCallback(async () => {
    try {
      setLoadError(null);
      const asg = await dispatchApi.getAssignment(assignmentId);
      setAssignment(asg);

      if (asg.journey_id) {
        // Fetch journey details & historical locations
        try {
          const journeyData = await journeysApi.get(asg.journey_id);
          if (journeyData.started_at) {
            setJourneyStartedAt(journeyData.started_at);
          }
          if (journeyData.total_distance_km) {
            setTotalDistanceKm(journeyData.total_distance_km);
          }
          if (!asg.tracking_url && journeyData.tracking_url) {
            setAssignment((prev) => (prev ? { ...prev, tracking_url: journeyData.tracking_url } : prev));
          }
        } catch (e) {
          console.warn('Could not fetch journey details', e);
        }

        try {
          const history = await locationApi.getHistory(asg.journey_id);
          if (history && history.length > 0) {
            const coords: [number, number][] = history.map((h) => [h.latitude, h.longitude]);
            setBreadcrumbs(coords);

            const lastFix = history[history.length - 1];
            setCurrentLocation((prev) => ({
              latitude: lastFix.latitude,
              longitude: lastFix.longitude,
              speed: lastFix.speed || 0,
              heading: lastFix.heading || 0,
              accuracy: lastFix.accuracy || 10,
              timestamp: lastFix.timestamp,
              adaptive_state: (lastFix as any).adaptive_state || prev?.adaptive_state || (lastFix.speed > 5 ? 'MOVING' : (lastFix.speed > 1.5 ? 'TRAFFIC' : 'STATIONARY')),
              acquisition_interval_sec: (lastFix as any).acquisition_interval_sec || prev?.acquisition_interval_sec || 5,
              transmission_interval_sec: (lastFix as any).transmission_interval_sec || prev?.transmission_interval_sec || 5,
              battery_saving: (lastFix as any).battery_saving ?? prev?.battery_saving ?? false,
            }));
          }
        } catch (e) {
          console.warn('Could not fetch location history', e);
        }
      }
    } catch (err: any) {
      console.error('Failed to load assignment tracking:', err);
      setLoadError(err?.response?.data?.detail || 'Failed to load delivery assignment. Please check company permissions.');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    loadAssignmentData();
    // 6-second polling fallback
    const interval = setInterval(loadAssignmentData, 6000);
    return () => clearInterval(interval);
  }, [loadAssignmentData]);

  // Subscribe to telematicsStore positions for real-time fleet updates
  const telematicsPositionsMap = useTelematicsStore((state) => state.positions.byDeviceId);
  const isGlobalSocketConnected = useTelematicsStore((state) => state.socket.connected);

  useEffect(() => {
    if (!assignment?.journey_id && !assignment?.driver_id) return;

    // Check recent telematics positions matching this assignment's journey or driver
    const allPositions = Object.values(telematicsPositionsMap);
    const matching = allPositions.filter(
      (p: Position) =>
        (assignment.journey_id && p.journey_id === assignment.journey_id) ||
        (assignment.driver_id && p.device_id === assignment.driver_id)
    );

    if (matching.length > 0) {
      const latest = matching[matching.length - 1];
      const adaptState = (latest.attributes?.adaptive_state || (latest.speed > 5 ? 'MOVING' : latest.speed > 1.5 ? 'TRAFFIC' : 'STATIONARY')) as AdaptiveTrackingState;
      const acqSec = latest.attributes?.acquisition_interval_sec || (adaptState === 'MOVING' ? 5 : adaptState === 'TRAFFIC' ? 15 : adaptState === 'STATIONARY' ? 30 : 60);
      const transSec = latest.attributes?.transmission_interval_sec || acqSec;
      const battSave = latest.attributes?.battery_saving ?? (adaptState === 'EXTENDED_IDLE');

      setCurrentLocation({
        latitude: latest.latitude,
        longitude: latest.longitude,
        speed: Math.round(latest.speed || 0),
        heading: Math.round(latest.course || 0),
        accuracy: Math.round((latest.accuracy || 10) * 10) / 10,
        timestamp: latest.device_time || latest.server_time || new Date().toISOString(),
        adaptive_state: adaptState,
        acquisition_interval_sec: acqSec,
        transmission_interval_sec: transSec,
        battery_saving: battSave,
      });

      setBreadcrumbs((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last[0] !== latest.latitude || last[1] !== latest.longitude) {
          return [...prev, [latest.latitude, latest.longitude]];
        }
        return prev;
      });
    }
  }, [telematicsPositionsMap, assignment?.journey_id, assignment?.driver_id]);

  // Dedicated Journey WebSocket Connection for instant delivery updates
  const wsJourneyUrl = useMemo(() => {
    if (!assignment?.journey_id) return null;
    const base = getApiBaseUrl();
    let wsHost = window.location.host;
    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (base.startsWith('http')) {
      const parsed = new URL(base);
      wsHost = parsed.host;
      wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    return `${wsProtocol}//${wsHost}/journey/${assignment.journey_id}`;
  }, [assignment?.journey_id]);

  const handleJourneyWsMessage = useCallback((msg: any) => {
    if (!msg) return;
    if (msg.type === 'LOCATION_UPDATE' || msg.type === 'POSITION' || msg.latitude != null) {
      const lat = msg.latitude;
      const lng = msg.longitude;
      const spd = Math.round(msg.speed || 0);
      const hdg = Math.round(msg.heading || 0);
      const acc = Math.round((msg.accuracy || 10) * 10) / 10;
      const rec = msg.timestamp || msg.recorded_at || new Date().toISOString();
      const adapt = (msg.adaptive_state || (spd > 5 ? 'MOVING' : spd > 1.5 ? 'TRAFFIC' : 'STATIONARY')) as AdaptiveTrackingState;
      const acq = msg.acquisition_interval_sec || (adapt === 'MOVING' ? 5 : adapt === 'TRAFFIC' ? 15 : adapt === 'STATIONARY' ? 30 : 60);
      const trans = msg.transmission_interval_sec || acq;
      const batt = msg.battery_saving ?? (adapt === 'EXTENDED_IDLE');

      setCurrentLocation({
        latitude: lat,
        longitude: lng,
        speed: spd,
        heading: hdg,
        accuracy: acc,
        timestamp: rec,
        adaptive_state: adapt,
        acquisition_interval_sec: acq,
        transmission_interval_sec: trans,
        battery_saving: batt,
      });

      if (msg.total_distance_km != null) {
        setTotalDistanceKm(msg.total_distance_km);
      }

      setBreadcrumbs((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last[0] !== lat || last[1] !== lng) {
          return [...prev, [lat, lng]];
        }
        return prev;
      });
    }
  }, []);

  const { isConnected: isJourneyWsConnected } = useWebSocket({
    url: wsJourneyUrl,
    onMessage: handleJourneyWsMessage,
  });

  const isSocketActive = isJourneyWsConnected || isGlobalSocketConnected;

  // Origin & Destination coordinates
  const originCoords: [number, number] = useMemo(() => {
    if (assignment?.origin_lat != null && assignment?.origin_lng != null) {
      return [assignment.origin_lat, assignment.origin_lng];
    }
    return [13.0827, 80.2707];
  }, [assignment?.origin_lat, assignment?.origin_lng]);

  const destCoords: [number, number] = useMemo(() => {
    if (assignment?.destination_lat != null && assignment?.destination_lng != null) {
      return [assignment.destination_lat, assignment.destination_lng];
    }
    return [13.1131, 80.2931];
  }, [assignment?.destination_lat, assignment?.destination_lng]);

  const vehicleCoords: [number, number] | null = useMemo(() => {
    if (currentLocation && currentLocation.latitude && currentLocation.longitude) {
      return [currentLocation.latitude, currentLocation.longitude];
    }
    return null;
  }, [currentLocation]);

  // Derived Telemetry Calculations
  const remainingDistanceKm = useMemo(() => {
    if (!vehicleCoords || !destCoords) return null;
    const distM = haversineMeters(vehicleCoords[0], vehicleCoords[1], destCoords[0], destCoords[1]);
    return Math.round((distM / 1000.0) * 10) / 10;
  }, [vehicleCoords, destCoords]);

  const etaMinutes = useMemo(() => {
    if (remainingDistanceKm === null || remainingDistanceKm <= 0.05) return 0;
    // Speed in km/h. If vehicle is currently stopped/traffic (< 5 km/h), assume standard urban speed of 30 km/h
    const effectiveSpeedKmh = Math.max(currentLocation?.speed || 0, 30);
    const hrs = remainingDistanceKm / effectiveSpeedKmh;
    return Math.max(1, Math.round(hrs * 60));
  }, [remainingDistanceKm, currentLocation?.speed]);

  // Adaptive Freshness & Countdown
  const activeIntervalSec = currentLocation?.transmission_interval_sec || 5;
  const freshness = calculateLiveTrackingFreshness(
    currentLocation?.timestamp,
    activeIntervalSec,
    isSocketActive,
    currentLocation?.adaptive_state
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] p-8 space-y-4">
        <LoadingSpinner />
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          Loading Live Delivery Tracking...
        </p>
      </div>
    );
  }

  if (loadError || !assignment) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <h4 className="font-bold text-rose-800">Unable to Open Live Tracking</h4>
            <p className="text-rose-700 mt-1">{loadError || 'Delivery assignment not found.'}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Delivery Monitoring</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12 font-sans animate-fadeIn">
      {/* Top Navigation Bar with Back Button & Live Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white/90 border border-black/10 rounded-3xl shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 hover:bg-black/5 active:bg-black/10 rounded-2xl border border-black/10 text-zinc-800 transition flex items-center justify-center shadow-sm cursor-pointer"
            title="Back to Delivery Monitoring"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Live Delivery Tracking</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-50 text-[#0071E3] font-bold border border-blue-200">
                REF: {assignment.id.slice(0, 8)}
              </span>
            </div>
            <h2 className="text-base font-bold text-zinc-900 leading-tight">
              {assignment.destination_name}
            </h2>
          </div>
        </div>

        {/* Dynamic Connection Status & Freshness Badge */}
        <div className="flex items-center gap-2.5">
          <div
            className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-2 shadow-sm ${freshness.statusBadgeClass}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                freshness.connectionStatus === 'LIVE'
                  ? 'bg-emerald-500 animate-ping'
                  : freshness.connectionStatus === 'STATIONARY'
                  ? 'bg-blue-500'
                  : 'bg-amber-500'
              }`}
            />
            <span>{freshness.connectionStatus}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (customerTrackingUrl && assignment.status === 'IN_PROGRESS') {
                window.open(customerTrackingUrl, '_blank', 'noopener,noreferrer');
              } else {
                alert('No active public tracking link is available for this delivery. The journey has not started yet or has already concluded.');
              }
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              customerTrackingUrl && assignment.status === 'IN_PROGRESS'
                ? 'bg-[#0071E3] hover:bg-blue-600 active:scale-95 text-white shadow-sm shadow-blue-500/20'
                : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'
            }`}
            title={
              customerTrackingUrl && assignment.status === 'IN_PROGRESS'
                ? 'Open Ephemeral Public Tracking Link'
                : 'Public tracking link is unavailable'
            }
          >
            <span>Customer Link</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Grid: Interactive Map (Left/Center) + Telemetry & Adaptive Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Map Column (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-2">
          {/* Map Toolbar */}
          <div className="flex items-center justify-between px-2 text-xs">
            <span className="font-bold text-zinc-700 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Real-Time Driver Journey Map</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCenterVehicleCount((c) => c + 1)}
                disabled={!vehicleCoords}
                className="px-2.5 py-1 bg-white hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50 text-zinc-800 border border-black/10 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                title="Center on Vehicle"
              >
                <Crosshair className="w-3 h-3 text-[#0071E3]" />
                <span>Center Vehicle</span>
              </button>
              <button
                type="button"
                onClick={() => setFitRouteCount((c) => c + 1)}
                className="px-2.5 py-1 bg-white hover:bg-zinc-50 active:bg-zinc-100 text-zinc-800 border border-black/10 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                title="Fit Route to Screen"
              >
                <Maximize2 className="w-3 h-3 text-zinc-600" />
                <span>Fit Route</span>
              </button>
            </div>
          </div>

          {/* Leaflet Map Canvas */}
          <div className="h-[460px] w-full rounded-3xl overflow-hidden border border-black/10 shadow-lg relative bg-zinc-100">
            <MapContainer
              center={vehicleCoords || originCoords}
              zoom={14}
              className="w-full h-full"
            >
              <TileLayer
                attribution={mapTile.attribution}
                url={mapTile.url}
                maxZoom={mapTile.maxZoom}
                tileSize={mapTile.tileSize}
                className={mapTile.className}
              />

              {/* Dynamic camera pan / fit controller */}
              <MapControllerComponent
                centerOnVehicleTrigger={centerVehicleCount}
                fitRouteTrigger={fitRouteCount}
                vehicleCoords={vehicleCoords}
                originCoords={originCoords}
                destinationCoords={destCoords}
                breadcrumbs={breadcrumbs}
              />

              {/* Origin Marker */}
              <Marker position={originCoords} icon={originIcon}>
                <Popup>
                  <div className="p-1 text-xs">
                    <strong className="text-zinc-900 block">Journey Origin</strong>
                    <span className="text-zinc-600 text-[11px]">{assignment.origin_name || 'Fleet Depot / Start'}</span>
                  </div>
                </Popup>
              </Marker>

              {/* Destination Marker */}
              <Marker position={destCoords} icon={destinationIcon}>
                <Popup>
                  <div className="p-1 text-xs">
                    <strong className="text-zinc-900 block">Delivery Destination</strong>
                    <span className="text-zinc-600 text-[11px]">{assignment.destination_name}</span>
                  </div>
                </Popup>
              </Marker>

              {/* Breadcrumb Trail of Route Travelled */}
              {breadcrumbs.length > 1 && (
                <Polyline
                  positions={breadcrumbs}
                  color="#0071e3"
                  weight={5}
                  opacity={0.85}
                  lineCap="round"
                  lineJoin="round"
                />
              )}

              {/* Live Vehicle Pulse Marker */}
              {vehicleCoords && (
                <Marker
                  position={vehicleCoords}
                  icon={createVehiclePulseIcon(currentLocation?.heading || 0)}
                >
                  <Popup>
                    <div className="p-1.5 text-xs space-y-1">
                      <strong className="text-zinc-900 block">
                        {assignment.vehicle_registration || 'Fleet Vehicle'}
                      </strong>
                      <p className="text-zinc-600 text-[11px]">Driver: {assignment.driver_name}</p>
                      <p className="text-[#0071E3] font-bold text-[11px]">
                        Speed: {currentLocation?.speed || 0} km/h • Heading: {formatCompassHeading(currentLocation?.heading)}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
        </div>

        {/* Right Information & Adaptive Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 1. Dynamic GPS Ping Interval & Live Update Panel (MODULE B) */}
          <div className="p-4 bg-gradient-to-br from-white via-blue-50/30 to-white border border-blue-200/80 rounded-3xl shadow-sm space-y-3.5">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#0071E3]" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-900">
                  Adaptive GPS Tracking Engine
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                  currentLocation?.adaptive_state === 'EXTENDED_IDLE'
                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                    : currentLocation?.adaptive_state === 'STATIONARY'
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : currentLocation?.adaptive_state === 'TRAFFIC'
                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                }`}
              >
                {currentLocation?.adaptive_state || 'MOVING'}
              </span>
            </div>

            {/* Interval Status Table */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-white/90 border border-black/5 rounded-2xl space-y-0.5">
                <span className="text-[10px] uppercase font-bold text-zinc-400 block">GPS Acquisition</span>
                <p className="text-xs font-bold text-zinc-800 font-mono">
                  Every {currentLocation?.acquisition_interval_sec || 5}s
                </p>
              </div>

              <div className="p-2.5 bg-white/90 border border-black/5 rounded-2xl space-y-0.5">
                <span className="text-[10px] uppercase font-bold text-zinc-400 block">Server Updates</span>
                <p className="text-xs font-bold text-[#0071E3] font-mono">
                  Every {currentLocation?.transmission_interval_sec || 5}s
                </p>
              </div>
            </div>

            {/* Countdown to next update & Last Update timestamp */}
            <div className="p-3 bg-zinc-50 border border-black/[0.04] rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 font-medium">Last GPS Update:</span>
                <strong className="text-zinc-900 font-mono">
                  {currentLocation?.timestamp
                    ? new Date(currentLocation.timestamp).toLocaleTimeString()
                    : 'Waiting for fix...'}
                </strong>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-600 font-medium">Time Elapsed:</span>
                <span className="text-zinc-800 font-mono font-bold">
                  {freshness.secondsElapsed}s ago
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-black/[0.04] pt-2">
                <span className="text-[#0071E3] font-bold flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Next Expected Update:</span>
                </span>
                <span className="text-xs font-mono font-bold text-[#0071E3] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                  in {freshness.countdownSec}s
                </span>
              </div>
            </div>

            {/* Battery Saving Mode pill */}
            <div className="flex items-center justify-between p-2.5 bg-white/90 border border-black/5 rounded-2xl text-xs">
              <span className="text-zinc-600 font-medium flex items-center gap-1.5">
                <Battery className="w-4 h-4 text-zinc-500" />
                <span>Battery-Saving Mode:</span>
              </span>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full font-mono ${
                  currentLocation?.battery_saving
                    ? 'bg-purple-100 text-purple-700 border border-purple-200'
                    : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                }`}
              >
                {currentLocation?.battery_saving ? 'ACTIVE (Eco 60s)' : 'STANDARD'}
              </span>
            </div>
          </div>

          {/* 2. Live Vehicle Telemetry Cards */}
          <div className="p-4 bg-white/90 border border-black/10 rounded-3xl shadow-sm space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-800 block border-b border-black/[0.06] pb-2">
              Live Vehicle Telemetry
            </span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {/* Current Speed */}
              <div className="p-3 bg-zinc-50 rounded-2xl border border-black/[0.04]">
                <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                  <Gauge className="w-3.5 h-3.5 text-[#0071E3]" />
                  <span className="text-[10px] uppercase font-bold">Speed</span>
                </div>
                <p className="text-lg font-bold font-mono text-zinc-900">
                  {currentLocation?.speed || 0}{' '}
                  <span className="text-xs font-medium text-zinc-500">km/h</span>
                </p>
              </div>

              {/* Heading */}
              <div className="p-3 bg-zinc-50 rounded-2xl border border-black/[0.04]">
                <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                  <Compass className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[10px] uppercase font-bold">Heading</span>
                </div>
                <p className="text-xs font-bold font-mono text-zinc-900 mt-1">
                  {formatCompassHeading(currentLocation?.heading)}
                </p>
              </div>

              {/* Distance Travelled */}
              <div className="p-3 bg-zinc-50 rounded-2xl border border-black/[0.04]">
                <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                  <Route className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[10px] uppercase font-bold">Travelled</span>
                </div>
                <p className="text-sm font-bold font-mono text-zinc-900">
                  {totalDistanceKm.toFixed(2)}{' '}
                  <span className="text-[10px] font-medium text-zinc-500">km</span>
                </p>
              </div>

              {/* Remaining Distance & Estimated Arrival */}
              <div className="p-3 bg-zinc-50 rounded-2xl border border-black/[0.04]">
                <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                  <Clock className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-[10px] uppercase font-bold">Est. Remaining</span>
                </div>
                <p className="text-sm font-bold font-mono text-zinc-900">
                  {remainingDistanceKm != null ? `${remainingDistanceKm} km` : 'Calculating...'}
                </p>
                <p className="text-[10px] text-zinc-500 font-medium mt-0.5">
                  ETA: ~{etaMinutes} mins (est.)
                </p>
              </div>
            </div>

            {/* GPS Accuracy */}
            <div className="flex items-center justify-between text-xs px-1 text-zinc-600">
              <span>GPS Accuracy:</span>
              <strong className="font-mono text-zinc-900">
                ±{currentLocation?.accuracy || 10} m
              </strong>
            </div>
          </div>

          {/* 3. Delivery Assignment & Vehicle Info Card */}
          <div className="p-4 bg-white/90 border border-black/10 rounded-3xl shadow-sm space-y-2.5 text-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-800 block border-b border-black/[0.06] pb-2">
              Delivery Assignment Details
            </span>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">Driver:</span>
                <strong className="text-zinc-900">{assignment.driver_name || 'Assigned Driver'}</strong>
              </div>

              <div className="flex justify-between">
                <span className="text-zinc-500">Assigned Vehicle:</span>
                <strong className="text-zinc-900 font-mono">
                  {assignment.vehicle_registration || 'VAN-01'}
                  {assignment.vehicle_model ? ` (${assignment.vehicle_model})` : ''}
                </strong>
              </div>

              <div className="flex justify-between">
                <span className="text-zinc-500">Dispatch Manager:</span>
                <span className="text-zinc-800 font-medium">{assignment.manager_name || 'Fleet Manager'}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-zinc-500">Delivery Status:</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-[#0071E3] border border-blue-200">
                  {assignment.status}
                </span>
              </div>

              {journeyStartedAt && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Started At:</span>
                  <span className="text-zinc-800 font-mono text-[11px]">
                    {new Date(journeyStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-black/[0.04]">
                <span className="text-zinc-500 block text-[10px] uppercase font-bold mb-0.5">Instructions:</span>
                <p className="text-zinc-800 italic bg-zinc-50 p-2 rounded-xl border border-black/[0.04]">
                  {assignment.instructions || 'Standard delivery. Handle safely.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
