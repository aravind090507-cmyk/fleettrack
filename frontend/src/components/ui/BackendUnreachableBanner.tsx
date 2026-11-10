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
    <div className="bg-[#1c0d11]/95 border-b border-[#b63b51]/40 text-[#fef7f3] px-4 py-2.5 text-xs flex items-center justify-between sticky top-0 z-[9999] backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <AlertCircle className="w-4 h-4 text-[#fda4af] shrink-0" />
        <span className="tracking-wide">
          <strong className="text-white font-semibold uppercase tracking-[0.08em] text-[11px]">Telematics Server Notice:</strong> Cannot reach telematics server at{' '}
          <code className="bg-[#b63b51]/30 border border-[#b63b51]/40 px-1.5 py-0.5 rounded font-mono text-[11px] text-[#f4f5f2]">{targetUrl}</code>. Live
          tracking stream may be reconnecting.
        </span>
      </div>
      <button
        type="button"
        onClick={checkBackend}
        disabled={checking}
        className="px-3 py-1 rounded-xl bg-[#b63b51] hover:bg-[#c9455d] text-white font-semibold text-[11px] tracking-wide flex items-center gap-1.5 shrink-0 border border-[#c9455d]/40 transition shadow-sm"
      >
        <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
        <span>{checking ? 'Connecting...' : 'Retry'}</span>
      </button>
    </div>
  );
};
