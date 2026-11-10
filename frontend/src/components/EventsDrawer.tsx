import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  X,
  AlertTriangle,
  Shield,
  Activity,
  ArrowRight,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTelematicsStore } from '../store/telematicsStore';
import { TelematicsEvent } from '../types';

function playAlertSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Audio autoplay restrictions or headless environment
  }
}

export const EventsDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const events = useTelematicsStore((s) => s.events);
  const lastEventIdRef = useRef<string | null>(null);

  // Play audio alert on new SOS or emergency events
  useEffect(() => {
    if (events.length > 0) {
      const newest = events[0];
      if (newest.id !== lastEventIdRef.current) {
        lastEventIdRef.current = newest.id;
        const isEmergency =
          newest.type === 'SOS' ||
          newest.type === 'deviceOverspeed' ||
          newest.type === 'BREAKDOWN';
        if (isEmergency && soundEnabled) {
          playAlertSound();
        }
      }
    }
  }, [events, soundEnabled]);

  const unreadCount = events.length;

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 p-3.5 rounded-full bg-bespoke-surface hover:bg-bespoke-card text-bespoke-gold shadow-2xl border border-bespoke-border hover:border-bespoke-gold/50 transition-all flex items-center justify-center cursor-pointer group"
        title="Live Fleet Events"
      >
        <Bell className="w-5 h-5 group-hover:scale-110 transition-transform" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-bespoke-error text-[10px] font-mono border border-bespoke-black text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-over Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-bespoke-black/70 backdrop-blur-xs transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          {/* Drawer Panel */}
          <aside className="relative w-full max-w-md bg-bespoke-surface border-l border-bespoke-border h-full flex flex-col shadow-2xl z-10 text-bespoke-champagne select-none font-sans">
            {/* Header */}
            <div className="p-4 border-b border-bespoke-border flex items-center justify-between bg-bespoke-dark/90">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-bespoke-gold" />
                <h3 className="font-light text-sm text-bespoke-offwhite uppercase tracking-[0.1em]">Live Telematics Events</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bespoke-card text-bespoke-champagne/70 border border-bespoke-border">
                  {events.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="p-1.5 rounded bg-bespoke-card hover:bg-bespoke-surface text-bespoke-champagne border border-bespoke-border transition"
                  title={soundEnabled ? 'Mute Alarm Sounds' : 'Unmute Alarm Sounds'}
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4 text-bespoke-gold" /> : <VolumeX className="w-4 h-4 text-bespoke-dim" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded bg-bespoke-card hover:bg-bespoke-surface text-bespoke-champagne border border-bespoke-border transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Events List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {events.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-bespoke-dim text-xs text-center p-6 font-mono uppercase tracking-wider">
                  <Activity className="w-8 h-8 mb-2 opacity-30 text-bespoke-gold" />
                  <p>No real-time events received yet.</p>
                  <p className="text-[10px] text-bespoke-dim/70 mt-1 font-sans">
                    Movement, geofences, overspeed, and SOS notifications will appear here.
                  </p>
                </div>
              ) : (
                events.map((ev) => {
                  const isSOS = ev.type === 'SOS';
                  const isBreakdown = ev.type === 'BREAKDOWN';
                  const isOverspeed = ev.type === 'deviceOverspeed';
                  const isGeofence = ev.type.startsWith('geofence');
                  const isMotion = ev.type === 'deviceMoving' || ev.type === 'deviceStopped';

                  let badgeColor = 'bg-bespoke-card text-bespoke-champagne border-bespoke-border';
                  if (isSOS) badgeColor = 'bg-bespoke-error/20 text-bespoke-linen border-bespoke-error animate-pulse';
                  else if (isBreakdown) badgeColor = 'bg-amber-950 text-amber-300 border-amber-800';
                  else if (isOverspeed) badgeColor = 'bg-orange-950 text-orange-300 border-orange-800';
                  else if (isGeofence) badgeColor = 'bg-bespoke-gold/15 text-bespoke-goldLight border-bespoke-gold/30';
                  else if (ev.type === 'deviceMoving') badgeColor = 'bg-bespoke-green/15 text-bespoke-green border-bespoke-green/30';

                  return (
                    <div
                      key={ev.id}
                      className="p-3 rounded bg-bespoke-dark/80 border border-bespoke-border space-y-1 hover:border-bespoke-gold/40 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${badgeColor}`}>
                          {ev.type}
                        </span>
                        <span className="text-[10px] text-bespoke-dim font-mono">
                          {new Date(ev.event_time).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-xs text-bespoke-champagne pt-1 flex items-center justify-between">
                        <span className="font-mono text-bespoke-offwhite">Device: {ev.device_id}</span>
                        {ev.attributes && ev.attributes.speed && (
                          <span className="font-mono text-bespoke-gold font-medium">
                            {Math.round(ev.attributes.speed)} km/h
                          </span>
                        )}
                      </div>

                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div className="text-[10px] font-mono text-bespoke-dim truncate pt-0.5">
                          {JSON.stringify(ev.attributes)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
