import React from 'react';
import clsx from 'clsx';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toUpperCase();

  const colorStyles: Record<string, string> = {
    IN_PROGRESS: 'bg-[#cb886c]/15 text-[#ebcfbc] border-[#cb886c]/30',
    IN_TRANSIT: 'bg-[#cb886c]/15 text-[#ebcfbc] border-[#cb886c]/30',
    AVAILABLE: 'bg-[#45c045]/15 text-[#9ae6b4] border-[#45c045]/30',
    COMPLETED: 'bg-[#f4f5f2]/10 text-[#dac9be] border-[#dac9be]/25',
    PAUSED: 'bg-[#d97706]/15 text-[#fcd34d] border-[#d97706]/30',
    MAINTENANCE: 'bg-[#d97706]/15 text-[#fcd34d] border-[#d97706]/30',
    OFFLINE: 'bg-[#b63b51]/15 text-[#fda4af] border-[#b63b51]/30',
    CANCELLED: 'bg-[#b63b51]/15 text-[#fda4af] border-[#b63b51]/30',
  };

  const style = colorStyles[normalized] || 'bg-[#1a1b1f] text-[#dac9be] border-[#26272b]';

  const sizeClasses = {
    sm: 'text-[10px] tracking-[0.08em] px-2 py-0.5 uppercase',
    md: 'text-xs tracking-[0.08em] px-2.5 py-1 uppercase',
    lg: 'text-xs tracking-[0.08em] px-3 py-1.5 uppercase',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-full border shadow-sm select-none',
        style,
        sizeClasses[size]
      )}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full', {
          'bg-[#cb886c] animate-pulse': normalized === 'IN_PROGRESS' || normalized === 'IN_TRANSIT',
          'bg-[#45c045]': normalized === 'AVAILABLE',
          'bg-amber-400': normalized === 'PAUSED' || normalized === 'MAINTENANCE',
          'bg-[#b63b51]': normalized === 'OFFLINE' || normalized === 'CANCELLED',
          'bg-[#dac9be]': normalized === 'COMPLETED',
        })}
      />
      {normalized.replace('_', ' ')}
    </span>
  );
};
