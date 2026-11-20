import React from 'react';
import {
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Radio,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  Satellite,
  Info,
} from 'lucide-react';
import { useLocationPermission } from '../../hooks/useLocationPermission';

export const LocationStatusIndicator: React.FC = () => {
  const { state, statusDisplay, coords, errorMessage, requestPermission, isRetrying } =
    useLocationPermission();

  // Color & icon schemes per status
  const getBadgeStyle = () => {
    switch (statusDisplay) {
      case 'LIVE GPS TRACKING':
        return {
          bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800',
          dot: 'bg-emerald-500 animate-pulse',
          icon: <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />,
        };
      case 'LOCATION ENABLED':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700',
          dot: 'bg-emerald-500',
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />,
        };
      case 'LOCATION ACCESS DENIED':
        return {
          bg: 'bg-rose-500/15 border-rose-500/30 text-rose-800',
          dot: 'bg-rose-500',
          icon: <ShieldAlert className="w-3 h-3 text-rose-600" />,
        };
      case 'TURN ON DEVICE LOCATION':
        return {
          bg: 'bg-amber-500/15 border-amber-500/30 text-amber-800',
          dot: 'bg-amber-500 animate-bounce',
          icon: <PowerOff className="w-3 h-3 text-amber-600" />,
        };
      case 'LOCATION UNAVAILABLE':
        return {
          bg: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-700',
          dot: 'bg-zinc-400',
          icon: <Satellite className="w-3 h-3 text-zinc-500" />,
        };
      case 'LOCATION PERMISSION REQUIRED':
      default:
        return {
          bg: 'bg-blue-500/15 border-blue-500/30 text-blue-800',
          dot: 'bg-blue-500',
          icon: <MapPin className="w-3 h-3 text-blue-600" />,
        };
    }
  };

  const badge = getBadgeStyle();
  const hasIssue = state !== 'granted';

  return (
    <div className="w-full mb-3 space-y-2">
      {/* Compact Location Status Indicator Pill */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/90 backdrop-blur-md rounded-xl border border-black/[0.06] shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center">{badge.icon}</div>
          <span
            data-testid="location-status-badge"
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${badge.bg}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
            {statusDisplay}
          </span>
        </div>

        {/* Small auxiliary telemetry info when granted */}
        {state === 'granted' && coords && (
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline truncate">
            ±{coords.accuracy}m accuracy
          </span>
        )}
      </div>

      {/* Prominent Action Banner when permission is not active */}
      {hasIssue && (
        <div
          data-testid="location-permission-alert"
          className={`p-3.5 rounded-2xl border backdrop-blur-md shadow-sm transition-all ${
            statusDisplay === 'LOCATION ACCESS DENIED'
              ? 'bg-rose-50/90 border-rose-200 text-rose-950'
              : statusDisplay === 'TURN ON DEVICE LOCATION'
              ? 'bg-amber-50/90 border-amber-200 text-amber-950'
              : statusDisplay === 'LOCATION UNAVAILABLE'
              ? 'bg-zinc-100/90 border-zinc-200 text-zinc-900'
              : 'bg-blue-50/90 border-blue-200 text-blue-950'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0">
              {statusDisplay === 'LOCATION ACCESS DENIED' ? (
                <ShieldAlert className="w-4 h-4 text-rose-600" />
              ) : statusDisplay === 'TURN ON DEVICE LOCATION' ? (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              ) : (
                <Info className="w-4 h-4 text-blue-600" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold leading-snug">
                {statusDisplay === 'LOCATION ACCESS DENIED'
                  ? 'Location Access Denied'
                  : statusDisplay === 'TURN ON DEVICE LOCATION'
                  ? 'Device Location Is Turned Off'
                  : statusDisplay === 'LOCATION UNAVAILABLE'
                  ? 'Location Signal Unavailable'
                  : 'Location Permission Required'}
              </h4>

              <p className="text-[11px] mt-1 leading-relaxed opacity-90">
                {errorMessage ||
                  (statusDisplay === 'LOCATION ACCESS DENIED'
                    ? 'Location permission is required for FleetTrack to track your journeys. Please enable location access in your browser settings.'
                    : statusDisplay === 'TURN ON DEVICE LOCATION'
                    ? 'Your device location is turned off. Please enable GPS/location services and try again.'
                    : 'Location access is required for vehicle tracking. Please grant browser permission to continue.')}
              </p>

              {/* Action Button: RETRY LOCATION PERMISSION */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="retry-location-permission-btn"
                  onClick={() => requestPermission()}
                  disabled={isRetrying}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer ${
                    statusDisplay === 'LOCATION ACCESS DENIED'
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : statusDisplay === 'TURN ON DEVICE LOCATION'
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : 'bg-[#0071E3] hover:bg-[#0077ED] text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                  <span>RETRY LOCATION PERMISSION</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
