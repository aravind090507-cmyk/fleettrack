import React from 'react';
import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className, title, action }) => {
  return (
    <div
      className={clsx(
        'bg-white/85 border border-white/80 rounded-3xl shadow-sm backdrop-blur-2xl overflow-hidden transition-all duration-200 text-zinc-900',
        className
      )}
    >
      {title && (
        <div className="px-5 py-3.5 border-b border-black/[0.04] flex items-center justify-between bg-zinc-50/60">
          <h3 className="text-xs font-bold tracking-wider text-zinc-700 uppercase">{title}</h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
};
