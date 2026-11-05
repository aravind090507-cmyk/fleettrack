import React from 'react';
import clsx from 'clsx';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toUpperCase();

  const colorStyles: Record<string, string> = {
    IN_PROGRESS: 'bg-emerald-950/80 text-emerald-400 border-emerald-700/50',
    IN_TRANSIT: 'bg-emerald-950/80 text-emerald-400 border-emerald-700/50',
    AVAILABLE: 'bg-blue-950/80 text-blue-400 border-blue-700/50',
    COMPLETED: 'bg-slate-800/80 text-slate-400 border-slate-700/50',
    PAUSED: 'bg-amber-950/80 text-amber-400 border-amber-700/50',
    MAINTENANCE: 'bg-amber-950/80 text-amber-400 border-amber-700/50',
    OFFLINE: 'bg-rose-950/80 text-rose-400 border-rose-700/50',
    CANCELLED: 'bg-rose-950/80 text-rose-400 border-rose-700/50',
  };

  const style = colorStyles[normalized] || 'bg-slate-800 text-slate-300 border-slate-700';

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-full border shadow-sm',
        style,
        sizeClasses[size]
      )}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full', {
          'bg-emerald-400 animate-pulse': normalized === 'IN_PROGRESS' || normalized === 'IN_TRANSIT',
          'bg-blue-400': normalized === 'AVAILABLE',
          'bg-amber-400': normalized === 'PAUSED' || normalized === 'MAINTENANCE',
          'bg-rose-400': normalized === 'OFFLINE' || normalized === 'CANCELLED',
          'bg-slate-400': normalized === 'COMPLETED',
        })}
      />
      {normalized.replace('_', ' ')}
    </span>
  );
};
