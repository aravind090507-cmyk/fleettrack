import React from 'react';
import { Menu, LogOut, Radio, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { NotificationBell } from '../components/notifications/NotificationBell';

interface TopbarProps {
  onToggleSidebar: () => void;
}

export function Topbar({ onToggleSidebar }: TopbarProps) {
  const { user, logout } = useAuthStore();
  const { isConnected, connectionStatus } = useWebSocket();

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Left side: Mobile Toggle + Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 lg:hidden"
          aria-label="Toggle Navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden sm:flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
            Live Fleet Monitoring
          </span>
        </div>
      </div>

      {/* Right side: WS Status, Notifications, User Menu, Logout */}
      <div className="flex items-center gap-3">
        {/* WebSocket Connection Status Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-[11px]">
          {connectionStatus === 'connected' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">Live Telemetry</span>
            </>
          ) : connectionStatus === 'reconnecting' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-400 font-medium">Reconnecting...</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-red-400 font-medium">Disconnected</span>
            </>
          )}
        </div>

        {/* Notifications Bell */}
        <NotificationBell />

        <div className="h-4 w-px bg-slate-800 hidden sm:block" />

        {/* User Info */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <div className="text-xs font-semibold text-white">{user?.name}</div>
            <div className="text-[10px] text-slate-400 capitalize">{user?.role.replace('_', ' ')}</div>
          </div>

          {/* Logout Action */}
          <button
            onClick={() => logout()}
            className="p-2 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
