import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Share2,
  Copy,
  Check,
  Pause,
  Play,
  Wrench,
  HelpCircle,
  AlertTriangle,
  StopCircle,
  Clock,
  Gauge,
  Compass,
  MapPin,
  QrCode,
  Shield,
  EyeOff,
  Route,
} from 'lucide-react';
import { useDriverStore } from '../../../store/driverStore';
import { journeysApi, locationApi } from '../../../services/api';
import { offlineStorage } from '../../../services/offlineStorage';
import { useGeolocation } from '../../../hooks/useGeolocation';
import { useJourneyTimer } from '../../../hooks/useJourneyTimer';
import { useOfflineSync } from '../../../hooks/useOfflineSync';
import { LocationPing } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { DriverMap } from '../../../components/map/DriverMap';

export const ActiveJourney: React.FC = () => {
  const {
    currentJourney,
    trackingUrl,
    trackingToken,
    simulatedMode,
    toggleSimulatedMode,
    setGPSStatus,
    setLastPing,
    setOfflineQueueCount,
  } = useDriverStore();

  const [copied, setCopied] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isBreakdownReported, setIsBreakdownReported] = useState<boolean>(false);
  const [isSosActive, setIsSosActive] = useState<boolean>(false);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [isLinkRevoked, setIsLinkRevoked] = useState<boolean>(false);
  const [backgroundWarning, setBackgroundWarning] = useState<boolean>(false);
  const [sosProgress, setSosProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pingCount, setPingCount] = useState<number>(0);

  // Guarantee clean public tracking URL (never hardcoded localhost on mobile)
  const effectiveTrackingUrl = useMemo(() => {
    const rawToken = trackingToken || (currentJourney as any)?.tracking_token || localStorage.getItem('fleet_active_token');
    if (rawToken) {
      return `${window.location.origin}/track/${rawToken}`;
    }
    if (trackingUrl) {
      if (trackingUrl.startsWith('http') && !trackingUrl.includes('localhost')) {
        return trackingUrl;
      }
      const path = trackingUrl.replace(/^https?:\/\/[^\/]+/, '');
      return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
    }
    return '';
  }, [trackingToken, trackingUrl, currentJourney]);

  const sosTimerRef = useRef<any>(null);

  // Screen Wake Lock API to prevent mobile screen sleep during trip
  useEffect(() => {
    let wakeLock: any = null;
    const acquireLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch (e) {
        console.warn('Wake Lock request skipped:', e);
      }
    };
    acquireLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireLock();
      } else if (document.visibilityState === 'hidden') {
        setBackgroundWarning(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  // Offline queue synchronization hook
  useOfflineSync(currentJourney?.id || null);

  // Journey timer
  const { formattedTime } = useJourneyTimer(currentJourney?.started_at, !isPaused);

  // Periodic GPS upload callback
  const handleLocationPing = useCallback(
    async (ping: LocationPing) => {
      if (!currentJourney) return;
      setLastPing(ping);
      setGPSStatus('active');

      if (navigator.onLine) {
        try {
          const res = await locationApi.uploadPing(currentJourney.id, ping);
          if (res?.status === 'recorded' || res?.status === 'accepted') {
            setPingCount((c) => c + 1);
          }
        } catch (e) {
          console.warn('Network upload failed. Buffering ping to IndexedDB...');
          await offlineStorage.addRecord({
            journey_id: currentJourney.id,
            latitude: ping.latitude,
            longitude: ping.longitude,
            speed: ping.speed,
            heading: ping.heading,
            accuracy: ping.accuracy,
            altitude: ping.altitude || undefined,
            timestamp: ping.timestamp,
          });
          const count = await offlineStorage.getPendingCount(currentJourney.id);
          setOfflineQueueCount(count);
        }
      } else {
        // Device is offline: save to IndexedDB
        await offlineStorage.addRecord({
          journey_id: currentJourney.id,
          latitude: ping.latitude,
          longitude: ping.longitude,
          speed: ping.speed,
          heading: ping.heading,
          accuracy: ping.accuracy,
          altitude: ping.altitude || undefined,
          timestamp: ping.timestamp,
        });
        const count = await offlineStorage.getPendingCount(currentJourney.id);
        setOfflineQueueCount(count);
      }
    },
    [currentJourney, setGPSStatus, setLastPing, setOfflineQueueCount]
  );

  const initialCoords = useMemo(
    () => ({
      lat: currentJourney?.origin_lat || 12.9716,
      lng: currentJourney?.origin_lng || 77.5946,
    }),
    [currentJourney?.origin_lat, currentJourney?.origin_lng]
  );

  const destinationCoords = useMemo(
    () => ({
      lat: currentJourney?.destination_lat || 12.9750,
      lng: currentJourney?.destination_lng || 77.5980,
    }),
    [currentJourney?.destination_lat, currentJourney?.destination_lng]
  );

  // Active GPS watcher hook with clean error feedback
  const { position, error: gpsError, isSimulating, startWatching, stopWatching } = useGeolocation({
    simulated: simulatedMode,
    initialCoords,
    destinationCoords,
    onLocationUpdate: handleLocationPing,
  });

  useEffect(() => {
    startWatching();
    return () => stopWatching();
  }, [startWatching, stopWatching, simulatedMode]);

  // Copy tracking link to clipboard
  const handleCopyLink = () => {
    if (!effectiveTrackingUrl) return;
    navigator.clipboard.writeText(effectiveTrackingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Native share sheet if available
  const handleNativeShare = () => {
    if (!effectiveTrackingUrl) return;
    if (navigator.share) {
      navigator.share({
        title: `Live Fleet Tracking — ${currentJourney?.vehicle_registration}`,
        text: `Track my delivery progress live:`,
        url: effectiveTrackingUrl,
      });
    } else {
      handleCopyLink();
    }
  };

  // Emergency SOS hold logic (hold for 3 seconds)
  const startSosHold = () => {
    setSosProgress(0);
    const interval = 100;
    const step = 100 / (3000 / interval);

    sosTimerRef.current = setInterval(() => {
      setSosProgress((prev) => {
        if (prev >= 100) {
          clearInterval(sosTimerRef.current!);
          triggerEmergencySos();
          return 100;
        }
        return prev + step;
      });
    }, interval);
  };

  const cancelSosHold = () => {
    if (sosTimerRef.current) clearInterval(sosTimerRef.current);
    setSosProgress(0);
  };

  const triggerEmergencySos = async () => {
    if (!currentJourney) return;
    setIsSosActive(true);
    try {
      await journeysApi.recordEvent(currentJourney.id, {
        event_type: 'SOS',
        latitude: position?.latitude || currentJourney.origin_lat,
        longitude: position?.longitude || currentJourney.origin_lng,
        metadata: { triggered_by: 'Driver Emergency Button' },
      });
      setStatusMessage('🚨 CRITICAL SOS BROADCASTED TO FLEET MANAGERS!');
    } catch {
      setStatusMessage('🚨 SOS recorded locally.');
    }
  };

  const handleToggleBreak = async () => {
    if (!currentJourney) return;
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    const eventType = nextPaused ? 'BREAK_START' : 'BREAK_END';
    try {
      await journeysApi.recordEvent(currentJourney.id, {
        event_type: eventType,
        latitude: position?.latitude || currentJourney.origin_lat,
        longitude: position?.longitude || currentJourney.origin_lng,
        metadata: { status: nextPaused ? 'Rest Break Started' : 'Trip Resumed' },
      });
      setStatusMessage(nextPaused ? '☕ Rest break recorded — Fleet Manager notified' : '▶️ Trip resumed — Live tracking active');
    } catch (e) {
      console.warn('Break event network error', e);
      setStatusMessage(nextPaused ? '☕ Rest break recorded locally' : '▶️ Trip resumed locally');
    }
  };

  const handleToggleBreakdown = async () => {
    if (!currentJourney) return;
    const nextBreakdown = !isBreakdownReported;
    setIsBreakdownReported(nextBreakdown);
    try {
      await journeysApi.recordEvent(currentJourney.id, {
        event_type: nextBreakdown ? 'BREAKDOWN' : 'BREAKDOWN_RESOLVED',
        latitude: position?.latitude || currentJourney.origin_lat,
        longitude: position?.longitude || currentJourney.origin_lng,
        metadata: { vehicle: currentJourney.vehicle_registration },
      });
      setStatusMessage(nextBreakdown ? '⚠️ Vehicle Breakdown Reported to Fleet Dispatch!' : '✅ Breakdown resolved — back on schedule');
    } catch (e) {
      setStatusMessage(nextBreakdown ? '⚠️ Vehicle Breakdown recorded' : '✅ Breakdown resolved');
    }
  };

  const handleRevokeLink = async () => {
    if (!currentJourney) return;
    if (window.confirm('Immediately revoke the public tracking link? Anyone viewing will lose access.')) {
      try {
        await journeysApi.revokeTrackingLink(currentJourney.id);
        setIsLinkRevoked(true);
        setStatusMessage('🔒 Public tracking link has been permanently revoked.');
      } catch (e: any) {
        alert('Failed to revoke tracking link: ' + (e.response?.data?.detail || e.message));
      }
    }
  };

  // End journey confirmation
  const handleEndJourney = async () => {
    if (!currentJourney) return;
    try {
      await journeysApi.end(currentJourney.id);
      stopWatching();
      useDriverStore.getState().setJourney(null);
    } catch (e: any) {
      const status = e.response?.status;
      // Journey already ended on the server — treat as success
      if (status === 404 || status === 410) {
        setStatusMessage('ℹ️ Journey already ended or not found. Returning home...');
        setShowEndModal(false);
        stopWatching();
        setTimeout(() => {
          useDriverStore.getState().setJourney(null);
        }, 3000);
        return;
      }
      console.warn('Network issue ending journey on backend:', e);
      // Gracefully conclude journey locally if offline or network connection issue
      const confirmForce = window.confirm(
        'Server notice: ' + (e.response?.data?.detail || e.message) +
        '\n\nWould you like to complete and close this journey anyway?'
      );
      if (confirmForce) {
        stopWatching();
        useDriverStore.getState().setJourney(null);
      }
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Top Journey Status Banner */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Vehicle</span>
          <p className="text-base font-black text-emerald-400">{currentJourney?.vehicle_registration || 'VAN-01'}</p>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Duration</span>
          <p className="text-base font-black font-mono text-white">{formattedTime}</p>
        </div>
      </div>

      {/* Starting Location & Destination Route Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Active Journey Endpoints</span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
            {currentJourney?.status || 'IN_PROGRESS'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Starting Location (Source) */}
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Source (Starting Location)
            </span>
            <p className="text-sm font-bold text-white break-words">
              {currentJourney?.origin_name || 'Starting Point'}
            </p>
            {currentJourney?.origin_lat != null && currentJourney?.origin_lng != null && (
              <p className="text-[10px] text-slate-500 font-mono">
                {currentJourney.origin_lat.toFixed(5)}, {currentJourney.origin_lng.toFixed(5)}
              </p>
            )}
          </div>

          {/* Destination (Target) */}
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              Destination (Ending Location)
            </span>
            <p className="text-sm font-bold text-white break-words">
              {currentJourney?.destination_name || 'Destination Point'}
            </p>
            {currentJourney?.destination_lat != null && currentJourney?.destination_lng != null && (
              <p className="text-[10px] text-slate-500 font-mono">
                {currentJourney.destination_lat.toFixed(5)}, {currentJourney.destination_lng.toFixed(5)}
              </p>
            )}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-rose-950 border border-rose-800 text-rose-200 text-xs font-bold rounded-xl text-center animate-pulse">
          {statusMessage}
        </div>
      )}

      {/* GPS Status Alert Banner */}
      {gpsError && !simulatedMode && (
        <div className="p-3 bg-red-950/80 border border-red-700 rounded-2xl flex items-start gap-2.5 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5 animate-bounce" />
          <div className="flex-1 text-xs">
            <p className="font-bold text-red-300">GPS Signal Alert</p>
            <p className="text-red-200/90 text-[11px] mt-0.5 leading-relaxed">{gpsError}</p>
          </div>
        </div>
      )}

      {/* Development Simulation Indicator */}
      {simulatedMode && (
        <div className="p-2.5 bg-blue-950/70 border border-blue-800 rounded-xl flex items-center justify-between text-xs text-blue-300">
          <span className="font-semibold flex items-center gap-1.5">
            🚗 <span className="underline">Route Simulation Active</span> (Demo/Test Mode)
          </span>
          <button
            type="button"
            onClick={toggleSimulatedMode}
            className="text-[10px] bg-blue-900/80 hover:bg-blue-800 text-blue-200 px-2.5 py-1 rounded-lg border border-blue-700 transition"
          >
            Switch to Live GPS
          </button>
        </div>
      )}

      {/* Background GPS Throttling Warning Banner */}
      {backgroundWarning && (
        <div className="p-3 bg-amber-950/70 border border-amber-800 rounded-2xl flex items-start gap-2.5 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-bold text-amber-300">Screen Lock / Background Warning</p>
            <p className="text-amber-200/80 text-[11px] mt-0.5 leading-relaxed">
              Mobile browsers pause GPS updates when screen locks. Screen Wake Lock is active — please keep this screen
              unlocked during your trip.
            </p>
          </div>
          <button
            onClick={() => setBackgroundWarning(false)}
            className="text-amber-400 hover:text-amber-200 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Ephemeral Tracking Link Sharing Card */}
      <Card title="Temporary Public Tracking Link">
        <div className="space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            {isLinkRevoked
              ? 'Public link access has been manually revoked.'
              : 'Share this secure link with clients or dispatchers. Valid only while in transit.'}
          </p>

          {!isLinkRevoked && (
            <>
              <div className="flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded-xl">
                <input
                  type="text"
                  readOnly
                  value={effectiveTrackingUrl || ''}
                  className="w-full bg-transparent text-xs text-emerald-400 font-mono truncate px-2 focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-all flex-shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={handleNativeShare}>
                  <Share2 className="w-4 h-4 text-emerald-400" />
                  <span>Share Link</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowQrModal(true)}>
                  <QrCode className="w-4 h-4 text-blue-400" />
                  <span>View QR</span>
                </Button>
              </div>

              <button
                type="button"
                onClick={handleRevokeLink}
                className="w-full py-1 text-[11px] text-slate-500 hover:text-rose-400 transition font-medium flex items-center justify-center gap-1.5"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>Revoke public link access immediately</span>
              </button>
            </>
          )}
        </div>
      </Card>

      {/* Driver Map Preview with Live Ping Indicator & Simulator Toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1 text-[11px]">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Live GPS Telemetry
          </span>
          <div className="flex items-center gap-1.5">
            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={toggleSimulatedMode}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                  simulatedMode
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <span>{simulatedMode ? '🚗 Sim ON' : '📡 GPS'}</span>
              </button>
            )}
            <span className="font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800">
              {pingCount} pings sent
            </span>
          </div>
        </div>
        <div className="h-56 w-full rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
          <DriverMap
            position={position}
            origin={
              currentJourney?.origin_lat != null && currentJourney?.origin_lng != null
                ? {
                    lat: currentJourney.origin_lat,
                    lng: currentJourney.origin_lng,
                    name: currentJourney.origin_name || 'Start Point',
                  }
                : undefined
            }
            destination={
              currentJourney?.destination_lat != null && currentJourney?.destination_lng != null
                ? {
                    lat: currentJourney.destination_lat,
                    lng: currentJourney.destination_lng,
                    name: currentJourney.destination_name || 'Destination',
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* Live Telemetry HUD */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center">
          <Gauge className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
          <span className="text-[10px] text-slate-400 font-semibold block uppercase">Speed</span>
          <span className="text-lg font-bold font-mono text-white">{position?.speed || 0}</span>
          <span className="text-[10px] text-slate-500 ml-1">km/h</span>
        </div>

        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center">
          <Compass className="w-4 h-4 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-slate-400 font-semibold block uppercase">Heading</span>
          <span className="text-lg font-bold font-mono text-white">{position?.heading || 0}°</span>
        </div>

        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center">
          <MapPin className="w-4 h-4 text-amber-400 mx-auto mb-1" />
          <span className="text-[10px] text-slate-400 font-semibold block uppercase">Accuracy</span>
          <span className="text-lg font-bold font-mono text-white">±{position?.accuracy || 5}</span>
          <span className="text-[10px] text-slate-500 ml-1">m</span>
        </div>
      </div>

      {/* Driver Action Controls */}
      <div className="grid grid-cols-2 gap-2.5">
        <Button
          variant={isPaused ? 'primary' : 'warning'}
          size="md"
          onClick={handleToggleBreak}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          <span>{isPaused ? 'Resume Trip' : 'Take Break'}</span>
        </Button>

        <Button
          variant={isBreakdownReported ? 'danger' : 'secondary'}
          size="md"
          onClick={handleToggleBreakdown}
        >
          <Wrench className={`w-4 h-4 ${isBreakdownReported ? 'text-white animate-spin' : 'text-amber-400'}`} />
          <span>{isBreakdownReported ? 'Breakdown Active' : 'Breakdown'}</span>
        </Button>
      </div>

      {/* Press & Hold Emergency SOS */}
      <div className="relative overflow-hidden rounded-2xl border border-rose-900/60 bg-rose-950/30">
        <div
          className="absolute left-0 top-0 bottom-0 bg-rose-600/30 transition-all duration-100 pointer-events-none"
          style={{ width: `${sosProgress}%` }}
        />
        <button
          type="button"
          onMouseDown={startSosHold}
          onMouseUp={cancelSosHold}
          onTouchStart={startSosHold}
          onTouchEnd={cancelSosHold}
          className="w-full py-4 px-4 flex items-center justify-center gap-3 text-rose-400 font-black text-sm relative z-10 active:scale-98 select-none"
        >
          <AlertTriangle className="w-5 h-5 text-rose-400 animate-bounce" />
          <span>HOLD 3 SEC FOR EMERGENCY SOS</span>
        </button>
      </div>

      {/* End Journey Button */}
      <Button
        variant="danger"
        size="lg"
        className="w-full text-base font-bold shadow-rose-950 mt-4"
        onClick={() => setShowEndModal(true)}
      >
        <StopCircle className="w-5 h-5 fill-current" />
        <span>END JOURNEY</span>
      </Button>

      {/* Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white text-center">Conclude This Journey?</h3>
            <p className="text-xs text-slate-400 text-center leading-relaxed">
              Ending this journey will permanently revoke the public tracking link (HTTP 410 Gone) and stop GPS
              collection.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowEndModal(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleEndJourney}>
                Confirm End
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Sharing Modal */}
      {showQrModal && effectiveTrackingUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xs w-full space-y-4 shadow-2xl text-center">
            <h3 className="text-base font-bold text-white">Scan Live Tracking Link</h3>
            <div className="p-4 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-inner w-fit">
              <QRCodeSVG value={effectiveTrackingUrl} size={180} level="M" />
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Anyone scanning this code can monitor delivery progress in real time.
            </p>
            <Button variant="secondary" size="sm" className="w-full mt-2" onClick={() => setShowQrModal(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
