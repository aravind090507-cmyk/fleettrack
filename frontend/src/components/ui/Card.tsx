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
        'bg-[#151619] border border-[#26272b] rounded-2xl shadow-2xl shadow-black/60 backdrop-blur-sm overflow-hidden transition-all duration-200',
        className
      )}
    >
      {title && (
        <div className="px-5 py-3.5 border-b border-[#26272b] flex items-center justify-between bg-[#111215]/50">
          <h3 className="text-xs font-semibold tracking-[0.1em] text-[#dac9be] uppercase">{title}</h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
};
