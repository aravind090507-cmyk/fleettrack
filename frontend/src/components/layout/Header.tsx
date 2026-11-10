import React from 'react';
import { Radio, Bell, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const { user } = useAuthStore();

  return (
    <header className="h-16 px-8 border-b border-[#222428] bg-[#0d0d0d]/90 backdrop-blur-md flex items-center justify-between z-20">
      <div>
        <h2 className="text-base font-semibold text-[#f4f5f2] tracking-wide">{title}</h2>
        {subtitle && <p className="text-[11px] text-[#9c9c9c] tracking-wide">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {/* Real-time streaming status pill */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#cb886c]/10 border border-[#cb886c]/30 text-[#ebcfbc] text-[10px] font-semibold tracking-[0.1em] uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#cb886c] animate-ping" />
          <span>TELEMETRY LIVE</span>
        </div>

        {/* Security badge */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#dac9be] bg-[#151619] px-2.5 py-1 rounded-lg border border-[#2a2b30]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#cb886c]" />
          <span className="tracking-wide">TLS 1.3 Verified</span>
        </div>
      </div>
    </header>
  );
};
