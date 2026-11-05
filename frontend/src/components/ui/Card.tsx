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
        'bg-slate-900/90 border border-slate-800/80 rounded-2xl shadow-xl shadow-slate-950/50 backdrop-blur-sm overflow-hidden',
        className
      )}
    >
      {title && (
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">{title}</h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
};
