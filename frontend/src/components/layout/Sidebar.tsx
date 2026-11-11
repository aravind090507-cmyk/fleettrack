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
  ShieldAlert,
  Smartphone,
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
    <aside className="w-64 bg-[#0d0d0d] border-r border-[#222428] flex flex-col h-screen select-none">
      {/* Brand */}
      <div className="h-16 px-6 flex items-center gap-3 border-b border-[#222428]">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#cb886c] to-[#ebcfbc] flex items-center justify-center shadow-lg shadow-black/80">
          <Radio className="w-4 h-4 text-[#0d0d0d] font-bold animate-pulse" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-[0.08em] text-[#f4f5f2] flex items-center gap-1.5 uppercase">
            FleetTrack
            <span className="text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-[#cb886c]/15 text-[#ebcfbc] border border-[#cb886c]/30">
              Bespoke
            </span>
          </h1>
          <p className="text-[10px] tracking-[0.08em] text-[#9c9c9c] uppercase">Private Telematics</p>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <p className="px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-[#636363] uppercase">
          Operations
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
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium tracking-wide transition-all duration-150',
                  isActive
                    ? 'bg-[#cb886c] text-[#0d0d0d] font-semibold shadow-lg shadow-[#cb886c]/20'
                    : 'text-[#9c9c9c] hover:text-[#f4f5f2] hover:bg-[#151619] hover:border hover:border-[#26272b]'
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
      <div className="p-4 border-t border-[#222428] bg-[#111215]/80">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="truncate">
            <p className="text-xs font-semibold text-[#f4f5f2] truncate">{user?.name || 'Manager'}</p>
            <p className="text-[10px] text-[#9c9c9c] truncate">{user?.email || 'manager@fleetcorp.com'}</p>
          </div>
          <span className="text-[9px] uppercase tracking-[0.08em] font-bold px-2 py-0.5 rounded-full bg-[#1a1b1f] text-[#dac9be] border border-[#2a2b30]">
            {user?.role || 'MANAGER'}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-[#f87171] hover:text-white hover:bg-[#b63b51]/30 rounded-xl transition-all border border-[#b63b51]/30"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
