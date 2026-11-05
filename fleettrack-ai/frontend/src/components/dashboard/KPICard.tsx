import React from 'react';
import { clsx } from 'clsx';
import { Card } from '../ui/Card';

export interface KPICardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'blue' | 'emerald' | 'amber' | 'red' | 'purple' | 'slate';
  trend?: {
    value: number;
    isPositive: boolean;
  };
  onClick?: () => void;
}

export function KPICard({
  title,
  value,
  subtitle,
  icon,
  variant = 'blue',
  trend,
  onClick,
}: KPICardProps) {
  const variantStyles = {
    blue: {
      iconBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      borderGlow: 'hover:border-blue-500/50',
      valueColor: 'text-white',
    },
    emerald: {
      iconBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      borderGlow: 'hover:border-emerald-500/50',
      valueColor: 'text-white',
    },
    amber: {
      iconBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      borderGlow: 'hover:border-amber-500/50',
      valueColor: 'text-white',
    },
    red: {
      iconBg: 'bg-red-500/10 text-red-400 border-red-500/20',
      borderGlow: 'hover:border-red-500/50',
      valueColor: 'text-white',
    },
    purple: {
      iconBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      borderGlow: 'hover:border-purple-500/50',
      valueColor: 'text-white',
    },
    slate: {
      iconBg: 'bg-slate-700/50 text-slate-400 border-slate-600/30',
      borderGlow: 'hover:border-slate-500/50',
      valueColor: 'text-white',
    },
  };

  const style = variantStyles[variant];

  return (
    <Card
      onClick={onClick}
      className={clsx(
        'p-5 transition-all duration-200 cursor-pointer group',
        style.borderGlow
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className={clsx('text-2xl font-bold tracking-tight', style.valueColor)}>
              {value}
            </span>
            {trend && (
              <span
                className={clsx(
                  'text-xs font-semibold',
                  trend.isPositive ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>

        <div className={clsx('p-3 rounded-xl border transition-transform group-hover:scale-105', style.iconBg)}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

export default KPICard;
