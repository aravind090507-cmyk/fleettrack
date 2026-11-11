import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MapPin,
  Truck,
  Route,
  History,
  LogOut,
  Radio,
  Shield,
  FileText,
  RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../store/authStore';

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/company', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/company/live-map', label: 'Live Fleet Map', icon: MapPin },
    { to: '/company/vehicles', label: 'Fleet Assets', icon: Truck },
    { to: '/company/journeys', label: 'Active Trips', icon: Route },
    { to: '/company/history', label: 'Trip History', icon: History },
    { to: '/company/geofences', label: 'Geofences', icon: Shield },
    { to: '/company/reports', label: 'Reports & Logs', icon: FileText },
    { to: '/company/replay', label: 'Route Replay', icon: RotateCcw },
  ];

  return (
    <aside className="w-64 bg-white/80 backdrop-blur-2xl border-r border-black/[0.06] flex flex-col h-screen select-none font-sans">
      {/* Brand */}
      <div className="h-16 px-6 flex items-center gap-3 border-b border-black/[0.06]">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0071E3] to-[#42A5F5] flex items-center justify-center shadow-md shadow-blue-500/25 text-white">
          <Radio className="w-4 h-4 animate-pulse" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-zinc-900 flex items-center gap-1.5">
            FleetTrack
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-blue-50 text-[#0071E3] border border-blue-200/60">
              Pro
            </span>
          </h1>
          <p className="text-[10px] text-zinc-500 font-medium">Enterprise Telematics</p>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
        <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Navigation
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all duration-150',
                  isActive
                    ? 'bg-[#0071E3] text-white shadow-md shadow-blue-500/25'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.04]'
                )
              }
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User profile footer */}
      <div className="p-4 border-t border-black/[0.06] bg-white/60">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="truncate">
            <p className="text-xs font-bold text-zinc-900 truncate">{user?.name || 'Manager'}</p>
            <p className="text-[10px] text-zinc-500 truncate">{user?.email || 'manager@fleetcorp.com'}</p>
          </div>
          <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
            {user?.role || 'MANAGER'}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-2xl transition-all border border-rose-200/70 shadow-sm cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
