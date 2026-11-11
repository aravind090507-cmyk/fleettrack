import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const { user } = useAuthStore();

  return (
    <header className="h-16 px-8 border-b border-black/[0.06] bg-white/80 backdrop-blur-2xl flex items-center justify-between z-20 select-none">
      <div>
        <h2 className="text-base font-bold text-zinc-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500 font-medium">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Real-time streaming status pill */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-xs font-bold shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>LIVE TELEMETRY</span>
        </div>

        {/* Security badge */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-600 bg-white/90 px-3 py-1 rounded-full border border-zinc-200/70 shadow-sm font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-[#0071E3]" />
          <span>TLS Encrypted</span>
        </div>
      </div>
    </header>
  );
};
