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
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-all',
        isOnline
          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
          : 'bg-amber-950/80 text-amber-300 border-amber-800/80 shadow-lg animate-pulse'
      )}
    >
      {isOnline ? (
        <>
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span>LIVE ONLINE</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5 text-amber-400" />
          <span>OFFLINE {queuedCount > 0 && `(${queuedCount} queued)`}</span>
        </>
      )}
    </div>
  );
};
