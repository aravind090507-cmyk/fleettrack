import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';

interface ConnectionStatusProps {
  isOnline: boolean;
  queuedCount?: number;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isOnline, queuedCount = 0 }) => {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono tracking-[0.1em] uppercase border backdrop-blur-md transition-all',
        isOnline
          ? 'bg-bespoke-green/10 text-bespoke-green border-bespoke-green/30'
          : 'bg-bespoke-error/15 text-bespoke-champagne border-bespoke-error/40 shadow-lg animate-pulse'
      )}
    >
      {isOnline ? (
        <>
          <Wifi className="w-3.5 h-3.5 text-bespoke-green" />
          <span>LIVE ONLINE</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5 text-bespoke-error" />
          <span>OFFLINE {queuedCount > 0 && `(${queuedCount} queued)`}</span>
        </>
      )}
    </div>
  );
};
