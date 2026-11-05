import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [sosProgress, setSosProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pingCount, setPingCount] = useState<number>(0);

  const sosTimerRef = useRef<any>(null);

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
          await locationApi.uploadPing(currentJourney.id, ping);
          setPingCount((c) => c + 1);
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

  // Active GPS watcher hook with automatic smart fallback
  const { position, error: gpsError, startWatching, stopWatching } = useGeolocation({
    simulated: simulatedMode,
    initialCoords: {
      lat: currentJourney?.origin_lat || 12.9716,
      lng: currentJourney?.origin_lng || 77.5946,
    },
    destinationCoords: {
      lat: currentJourney?.destination_lat || 12.9750,
      lng: currentJourney?.destination_lng || 77.5980,
    },
    onLocationUpdate: handleLocationPing,
  });

  useEffect(() => {
    startWatching();
    return () => stopWatching();
  }, [startWatching, stopWatching, simulatedMode]);

  // Immediately send initial origin ping on mount if pingCount is 0
  useEffect(() => {
    if (currentJourney && pingCount === 0) {
      const initPing: LocationPing = {
        latitude: currentJourney.origin_lat,
        longitude: currentJourney.origin_lng,
        speed: 0,
        heading: 0,
        accuracy: 5,
        altitude: null,
        timestamp: new Date().toISOString(),
      };
      handleLocationPing(initPing);
    }
  }, [currentJourney, handleLocationPing, pingCount]);

  // Copy tracking link to clipboard
  const handleCopyLink = () => {
    if (!trackingUrl) return;
    navigator.clipboard.writeText(trackingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Native share sheet if available
  const handleNativeShare = () => {
    if (!trackingUrl) return;
    if (navigator.share) {
      navigator.share({
        title: `Live Fleet Tracking — ${currentJourney?.vehicle_registration}`,
        text: `Track my delivery progress live:`,
        url: trackingUrl,
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

  // End journey confirmation
  const handleEndJourney = async () => {
    if (!currentJourney) return;
    try {
      await journeysApi.end(currentJourney.id);
      stopWatching();
      useDriverStore.getState().setJourney(null);
    } catch (e: any) {
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

      {statusMessage && (
        <div className="p-3 bg-rose-950 border border-rose-800 text-rose-200 text-xs font-bold rounded-xl text-center animate-pulse">
          {statusMessage}
        </div>
      )}

      {/* Ephemeral Tracking Link Sharing Card */}
      <Card title="Temporary Public Tracking Link">
        <div className="space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            Share this secure link with clients or dispatchers. Valid only while in transit.
          </p>

          <div className="flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded-xl">
            <input
              type="text"
              readOnly
              value={trackingUrl || ''}
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

          <Button variant="secondary" size="sm" className="w-full" onClick={handleNativeShare}>
            <Share2 className="w-4 h-4 text-emerald-400" />
            <span>Share Tracking Link</span>
          </Button>
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
            <button
              type="button"
              onClick={toggleSimulatedMode}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                simulatedMode
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <span>{simulatedMode ? '🚗 Sim Drive ON' : '📡 Device GPS'}</span>
            </button>
            <span className="font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800">
              {pingCount} pings sent
            </span>
          </div>
        </div>
        <div className="h-44 w-full rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
          <DriverMap position={position} />
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
    </div>
  );
};
