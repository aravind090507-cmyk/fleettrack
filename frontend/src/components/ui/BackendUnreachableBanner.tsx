import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { healthApi, getApiBaseUrl } from '../../services/api';
import { useTelematicsStore } from '../../store/telematicsStore';

export const BackendUnreachableBanner: React.FC = () => {
  const [isUnreachable, setIsUnreachable] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);
  const socketConnected = useTelematicsStore((s) => s.socket.connected);

  const checkBackend = useCallback(async () => {
    setChecking(true);
    const res = await healthApi.check();
    if (!res || res.status !== 'healthy') {
      setIsUnreachable(true);
    } else {
      setIsUnreachable(false);
    }
    setChecking(false);
  }, []);

  // Check once on load
  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  // Check when socket is disconnected
  useEffect(() => {
    if (!socketConnected) {
      checkBackend();
    } else {
      setIsUnreachable(false);
    }
  }, [socketConnected, checkBackend]);

  if (!isUnreachable) return null;

  const targetUrl = getApiBaseUrl() || window.location.origin;

  return (
    <div className="bg-rose-950/90 border-b border-rose-800 text-rose-200 px-4 py-2 text-xs flex items-center justify-between sticky top-0 z-[9999] backdrop-blur-md">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
        <span>
          <strong className="text-white font-semibold">Backend Unreachable:</strong> Cannot reach telematics server at{' '}
          <code className="bg-rose-900/60 px-1 py-0.5 rounded font-mono text-[11px] text-white">{targetUrl}</code>. Live
          tracking and data persistence may be paused.
        </span>
      </div>
      <button
        type="button"
        onClick={checkBackend}
        disabled={checking}
        className="px-2.5 py-1 rounded-lg bg-rose-900 hover:bg-rose-800 text-white font-bold text-[11px] flex items-center gap-1 shrink-0 border border-rose-700 transition"
      >
        <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
        <span>{checking ? 'Testing...' : 'Retry'}</span>
      </button>
    </div>
  );
};
