import React from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  message?: string;
}

export function Spinner({ size = 'md', className, message }: SpinnerProps) {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={twMerge(clsx('flex flex-col items-center justify-center gap-3', className))}>
      <Loader2 className={twMerge(clsx('animate-spin text-blue-500', sizes[size]))} />
      {message && <p className="text-xs text-slate-400 font-medium">{message}</p>}
    </div>
  );
}

export default Spinner;
