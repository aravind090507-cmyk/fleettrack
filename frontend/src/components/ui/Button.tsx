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
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none tracking-wide';

  const variants = {
    primary:
      'bg-[#cb886c] hover:bg-[#d9977c] text-[#0d0d0d] font-semibold shadow-lg shadow-[#cb886c]/20 border border-[#cb886c]/40',
    secondary:
      'bg-[#1a1b1f] hover:bg-[#222429] text-[#f4f5f2] border border-[#2a2b30] hover:border-[#cb886c]/40 shadow-sm',
    danger:
      'bg-[#b63b51] hover:bg-[#c9455d] text-white shadow-lg shadow-[#b63b51]/30 border border-[#b63b51]/40',
    warning:
      'bg-[#d97706] hover:bg-[#b45309] text-white shadow-lg shadow-amber-950/40 border border-amber-600/30',
    ghost:
      'hover:bg-[#1a1b1f] text-[#dac9be] hover:text-[#f4f5f2] border border-transparent hover:border-[#26272b]',
  };

  const sizes = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 min-h-[36px]',
    md: 'text-sm px-4 py-2.5 gap-2 min-h-[44px]',
    lg: 'text-base px-6 py-3.5 gap-2.5 min-h-[52px]',
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
