import React, { HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const variants = {
    default: 'bg-slate-700/80 text-slate-300 border-slate-600',
    success: 'bg-emerald-950/50 text-emerald-400 border-emerald-600/30',
    warning: 'bg-amber-950/50 text-amber-400 border-amber-600/30',
    danger: 'bg-red-950/50 text-red-400 border-red-600/30',
    info: 'bg-blue-950/50 text-blue-400 border-blue-600/30',
    purple: 'bg-purple-950/50 text-purple-400 border-purple-600/30',
    outline: 'bg-transparent text-slate-300 border-slate-600',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 rounded',
    md: 'text-xs px-2.5 py-1 rounded-md',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 font-medium border uppercase tracking-wider',
          variants[variant],
          sizes[size],
          className
        )
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
