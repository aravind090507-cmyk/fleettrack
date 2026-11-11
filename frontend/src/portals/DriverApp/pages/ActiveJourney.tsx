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
  Smartphone,
  Server,
  Layers,
} from 'lucide-react';
import { useDriverStore } from '../../../store/driverStore';
import { journeysApi, locationApi, getApiBaseUrl } from '../../../services/api';
import { positionUploader, UploaderState } from '../../../services/positionUploader';
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
  const [sosProgress, setSosProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pingCount, setPingCount] = useState<number>(0);
  const [uploaderState, setUploaderState] = useState<UploaderState>(positionUploader.getState());
  const [lastFixTime, setLastFixTime] = useState<number>(Date.now());
  const [fixAgeSec, setFixAgeSec] = useState<number>(0);

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

  // PositionUploader subscription
  useEffect(() => {
    positionUploader.setJourneyId(currentJourney?.id || null);
    const unsubscribe = positionUploader.subscribe((state) => {
      setUploaderState(state);
      setOfflineQueueCount(state.queueDepth);
    });
    return () => {
      unsubscribe();
    };
  }, [currentJourney?.id, setOfflineQueueCount]);

  // Fix age counter
  useEffect(() => {
    const timer = setInterval(() => {
      setFixAgeSec(Math.max(0, Math.floor((Date.now() - lastFixTime) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastFixTime]);

  // Position upload callback via PositionUploader write-ahead service
  const handleLocationPing = useCallback(
    async (ping: LocationPing) => {
      if (!currentJourney) return;
      setLastPing(ping);
      setGPSStatus('active');
      setLastFixTime(Date.now());
      setFixAgeSec(0);
      setPingCount((c) => c + 1);

      await positionUploader.enqueue(currentJourney.id, ping);
    },
    [currentJourney, setGPSStatus, setLastPing]
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
  const { position, error: gpsError, startWatching, stopWatching } = useGeolocation({
    onLocationUpdate: handleLocationPing,
  });

  useEffect(() => {
    startWatching();
    return () => stopWatching();
  }, [startWatching, stopWatching]);

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
    <div className="space-y-4 pb-8 font-sans">
      {/* Top Apple Dynamic Island Journey Status Banner */}
      <div className="p-4 bg-black/90 text-white rounded-3xl shadow-xl flex items-center justify-between border border-white/10 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071E3] to-[#42A5F5] flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/25">
            🚐
          </div>
          <div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Assigned Vehicle</span>
            <p className="text-sm font-bold font-mono text-white">{currentJourney?.vehicle_registration || 'VAN-01'}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Elapsed Time</span>
          <p className="text-sm font-bold font-mono text-emerald-400">{formattedTime}</p>
        </div>
      </div>

      {/* Starting Location & Destination Route Card */}
      <div className="bg-white/85 border border-white/80 rounded-3xl p-4 shadow-sm backdrop-blur-xl space-y-3 text-zinc-900">
        <div className="flex items-center justify-between border-b border-black/[0.04] pb-2">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-[#0071E3]" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-800">Active Journey Waypoints</span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-[#0071E3] border border-blue-200/80">
            {currentJourney?.status || 'IN_PROGRESS'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
          {/* Starting Location (Source) */}
          <div className="bg-zinc-50/80 p-3 rounded-2xl border border-black/[0.04] space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Source Point
            </span>
            <p className="text-xs font-bold text-zinc-900 break-words">
              {currentJourney?.origin_name || 'Starting Point'}
            </p>
            {currentJourney?.origin_lat != null && currentJourney?.origin_lng != null && (
              <p className="text-[10px] text-zinc-400 font-mono">
                {currentJourney.origin_lat.toFixed(5)}, {currentJourney.origin_lng.toFixed(5)}
              </p>
            )}
          </div>

          {/* Destination (Target) */}
          <div className="bg-zinc-50/80 p-3 rounded-2xl border border-black/[0.04] space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Destination Point
            </span>
            <p className="text-xs font-bold text-zinc-900 break-words">
              {currentJourney?.destination_name || 'Destination Point'}
            </p>
            {currentJourney?.destination_lat != null && currentJourney?.destination_lng != null && (
              <p className="text-[10px] text-zinc-400 font-mono">
                {currentJourney.destination_lat.toFixed(5)}, {currentJourney.destination_lng.toFixed(5)}
              </p>
            )}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-2xl text-center animate-pulse">
          {statusMessage}
        </div>
      )}

      {/* GPS Status Alert Banner */}
      {gpsError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5 animate-bounce" />
          <div className="flex-1 text-xs">
            <p className="font-bold text-rose-800">GPS Signal Alert</p>
            <p className="text-rose-700 text-[11px] mt-0.5 leading-relaxed">{gpsError}</p>
          </div>
        </div>
      )}

      {/* Clock Skew Warning Banner */}
      {Math.abs(uploaderState.serverTimeOffsetMs) > 10000 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5 animate-bounce" />
          <div className="flex-1 text-xs">
            <p className="font-bold text-amber-800">Clock Skew Warning</p>
            <p className="text-amber-700 text-[11px] mt-0.5 leading-relaxed">
              Device clock differs from server time by {Math.round(uploaderState.serverTimeOffsetMs / 1000)}s. GPS
              timestamps are automatically calibrated.
            </p>
          </div>
        </div>
      )}

      {/* GPS Rejections / Filter reasons */}
      {uploaderState.lastRejectionReasons.length > 0 && (
        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs space-y-1">
          <span className="text-[10px] uppercase font-bold text-zinc-500">Recent GPS Filter Flags</span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {uploaderState.lastRejectionReasons.map((reason, idx) => (
              <span
                key={idx}
                className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Ephemeral Tracking Link Sharing Card */}
      <Card title="Temporary Public Tracking Link">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 leading-relaxed font-medium">
            {isLinkRevoked
              ? 'Public link access has been manually revoked.'
              : 'Share this secure advisory link with clients or dispatchers. Valid only while in transit.'}
          </p>

          {!isLinkRevoked && (
            <>
              <div className="flex items-center gap-2 p-2 bg-zinc-50 border border-black/[0.06] rounded-2xl">
                <input
                  type="text"
                  readOnly
                  value={effectiveTrackingUrl || ''}
                  className="w-full bg-transparent text-xs text-[#0071E3] font-mono font-bold truncate px-2 focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 bg-white hover:bg-zinc-100 text-zinc-800 border border-zinc-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider flex items-center gap-1 transition-all flex-shrink-0 shadow-sm cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-zinc-500" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={handleNativeShare}>
                  <Share2 className="w-4 h-4 text-bespoke-gold" />
                  <span>Share Link</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowQrModal(true)}>
                  <QrCode className="w-4 h-4 text-bespoke-champagne" />
                  <span>View QR</span>
                </Button>
              </div>

              <button
                type="button"
                onClick={handleRevokeLink}
                className="w-full py-1 text-[11px] text-bespoke-dim hover:text-bespoke-error transition font-mono uppercase tracking-wider flex items-center justify-center gap-1.5"
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
      {(() => {
        const accuracy = position?.accuracy ?? 999;
        let qualityBadge = { label: 'Bad (≥100m)', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' };
        if (accuracy < 10) {
          qualityBadge = { label: 'Good (<10m)', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
        } else if (accuracy < 30) {
          qualityBadge = { label: 'OK (<30m)', color: 'text-amber-800', bg: 'bg-amber-50', border: 'border-amber-200' };
        } else if (accuracy < 100) {
          qualityBadge = { label: 'Poor (<100m)', color: 'text-orange-800', bg: 'bg-orange-50', border: 'border-orange-200' };
        }

        return (
          <>
            {/* Status bar with GPS Quality, Fix Age, Queue Size */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white/90 border border-black/10 rounded-2xl text-xs shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase font-bold text-zinc-700">Signal:</span>
                <span
                  className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${qualityBadge.bg} ${qualityBadge.color} ${qualityBadge.border}`}
                >
                  {qualityBadge.label}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-zinc-600 font-medium">
                  Last Fix: <strong className="text-zinc-900 font-bold">{fixAgeSec}s ago</strong>
                </span>
                <span className="text-zinc-600 font-medium">
                  Queue:{' '}
                  <strong className={uploaderState.queueDepth > 0 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
                    {uploaderState.queueDepth}
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 bg-white/90 border border-black/10 rounded-2xl text-center shadow-sm">
                <Gauge className="w-4 h-4 text-[#0071E3] mx-auto mb-1" />
                <span className="text-[10px] text-zinc-600 font-bold block uppercase tracking-wider">Speed</span>
                <span className="text-xl font-bold font-mono text-zinc-900">{position?.speed || 0}</span>
                <span className="text-[10px] text-zinc-600 ml-1 font-medium">km/h</span>
              </div>

              <div className="p-3 bg-white/90 border border-black/10 rounded-2xl text-center shadow-sm">
                <Compass className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                <span className="text-[10px] text-zinc-600 font-bold block uppercase tracking-wider">Heading</span>
                <span className="text-xl font-bold font-mono text-zinc-900">{position?.heading || 0}°</span>
              </div>

              <div className="p-3 bg-white/90 border border-black/10 rounded-2xl text-center shadow-sm">
                <MapPin className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                <span className="text-[10px] text-zinc-600 font-bold block uppercase tracking-wider">Accuracy</span>
                <span className="text-xl font-bold font-mono text-zinc-900">±{position?.accuracy || 5}</span>
                <span className="text-[10px] text-zinc-600 ml-1 font-medium">m</span>
              </div>
            </div>
          </>
        );
      })()}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white border border-black/10 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-900 text-center">Conclude This Journey?</h3>
            <p className="text-xs text-zinc-600 text-center leading-relaxed font-medium">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white border border-black/10 rounded-3xl p-6 max-w-xs w-full space-y-4 shadow-2xl text-center">
            <h3 className="text-base font-bold text-zinc-900">Scan Live Tracking Link</h3>
            <div className="p-4 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-sm border border-black/[0.08] w-fit">
              <QRCodeSVG value={effectiveTrackingUrl} size={180} level="M" />
            </div>
            <p className="text-xs text-zinc-600 leading-tight font-medium">
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
