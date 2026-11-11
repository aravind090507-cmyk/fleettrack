import React from 'react';
import clsx from 'clsx';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toUpperCase();

  const colorStyles: Record<string, string> = {
    IN_PROGRESS: 'bg-blue-50 text-[#0071E3] border-blue-200/80',
    IN_TRANSIT: 'bg-blue-50 text-[#0071E3] border-blue-200/80',
    AVAILABLE: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    COMPLETED: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    PAUSED: 'bg-amber-50 text-amber-800 border-amber-200/80',
    MAINTENANCE: 'bg-amber-50 text-amber-800 border-amber-200/80',
    OFFLINE: 'bg-rose-50 text-rose-700 border-rose-200/80',
    CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200/80',
  };

  const style = colorStyles[normalized] || 'bg-zinc-100 text-zinc-700 border-zinc-200';

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 uppercase font-bold tracking-wider',
    md: 'text-xs px-2.5 py-1 uppercase font-bold tracking-wider',
    lg: 'text-xs px-3.5 py-1.5 uppercase font-bold tracking-wider',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border shadow-sm select-none',
        style,
        sizeClasses[size]
      )}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full', {
          'bg-[#0071E3] animate-pulse': normalized === 'IN_PROGRESS' || normalized === 'IN_TRANSIT',
          'bg-emerald-500': normalized === 'AVAILABLE',
          'bg-amber-500': normalized === 'PAUSED' || normalized === 'MAINTENANCE',
          'bg-rose-500': normalized === 'OFFLINE' || normalized === 'CANCELLED',
          'bg-zinc-400': normalized === 'COMPLETED',
        })}
      />
      {normalized.replace('_', ' ')}
    </span>
  );
};
