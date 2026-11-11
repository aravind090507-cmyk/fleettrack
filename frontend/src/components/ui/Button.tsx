import React from 'react';
import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center font-semibold rounded-full transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none tracking-wide cursor-pointer';

  const variants = {
    primary:
      'bg-[#0071E3] hover:bg-[#0077ED] text-white shadow-md shadow-blue-500/25 border border-blue-400/20',
    secondary:
      'bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200/80 shadow-sm',
    danger:
      'bg-[#FF3B30] hover:bg-rose-600 text-white shadow-md shadow-rose-500/25 border border-rose-400/20',
    warning:
      'bg-[#FF9500] hover:bg-amber-600 text-white shadow-md shadow-amber-500/25 border border-amber-400/20',
    ghost:
      'hover:bg-black/[0.05] text-zinc-600 hover:text-zinc-900 border border-transparent',
  };

  const sizes = {
    sm: 'text-xs px-3.5 py-1.5 gap-1.5 min-h-[34px]',
    md: 'text-sm px-4.5 py-2.5 gap-2 min-h-[40px]',
    lg: 'text-base px-6 py-3.5 gap-2.5 min-h-[48px]',
  };

  return (
    <button
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      ) : null}
      {children}
    </button>
  );
};
