import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  X,
  Activity,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTelematicsStore } from '../store/telematicsStore';

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
        className="fixed bottom-6 right-6 z-40 p-3.5 rounded-full bg-white hover:bg-zinc-50 text-zinc-900 shadow-xl border border-black/10 transition-all flex items-center justify-center cursor-pointer group"
        title="Live Fleet Events"
      >
        <Bell className="w-5 h-5 text-[#0071E3] group-hover:scale-110 transition-transform" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-[#FF3B30] text-[10px] font-mono font-bold text-white shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-over Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          {/* Drawer Panel */}
          <aside className="relative w-full max-w-md bg-white/95 backdrop-blur-2xl border-l border-black/10 h-full flex flex-col shadow-2xl z-10 text-zinc-900 select-none font-sans">
            {/* Header */}
            <div className="p-4 border-b border-black/[0.06] flex items-center justify-between bg-white/80">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#0071E3]" />
                <h3 className="font-bold text-sm text-zinc-900 tracking-tight">Live Telematics Events</h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200">
                  {events.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="p-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition"
                  title={soundEnabled ? 'Mute Alarm Sounds' : 'Unmute Alarm Sounds'}
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4 text-[#0071E3]" /> : <VolumeX className="w-4 h-4 text-zinc-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Events List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {events.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs text-center p-6 font-semibold">
                  <Activity className="w-8 h-8 mb-2 opacity-30 text-[#0071E3]" />
                  <p>No real-time events received yet.</p>
                  <p className="text-[11px] text-zinc-500 mt-1 font-normal">
                    Movement, geofences, overspeed, and SOS notifications will appear here.
                  </p>
                </div>
              ) : (
                events.map((ev) => {
                  const isSOS = ev.type === 'SOS';
                  const isBreakdown = ev.type === 'BREAKDOWN';
                  const isOverspeed = ev.type === 'deviceOverspeed';
                  const isGeofence = ev.type.startsWith('geofence');

                  let badgeColor = 'bg-zinc-100 text-zinc-800 border-zinc-200';
                  if (isSOS) badgeColor = 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse';
                  else if (isBreakdown) badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                  else if (isOverspeed) badgeColor = 'bg-orange-50 text-orange-800 border-orange-200';
                  else if (isGeofence) badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
                  else if (ev.type === 'deviceMoving') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';

                  return (
                    <div
                      key={ev.id}
                      className="p-3.5 rounded-2xl bg-white border border-black/[0.08] space-y-1.5 shadow-sm hover:border-[#0071E3]/50 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${badgeColor}`}>
                          {ev.type}
                        </span>
                        <span className="text-[11px] text-zinc-600 font-mono font-medium">
                          {new Date(ev.event_time).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-900 pt-1 flex items-center justify-between">
                        <span className="font-mono font-bold text-zinc-900">Device: {ev.device_id}</span>
                        {ev.attributes && ev.attributes.speed && (
                          <span className="font-mono text-[#0071E3] font-bold">
                            {Math.round(ev.attributes.speed)} km/h
                          </span>
                        )}
                      </div>

                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div className="text-[10px] font-mono text-zinc-600 truncate pt-0.5">
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
