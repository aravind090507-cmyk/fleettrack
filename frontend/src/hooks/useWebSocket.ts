import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketMessage } from '../types';
import { getApiBaseUrl } from '../services/api';

interface UseWebSocketOptions {
  url: string | null;
  onMessage?: (msg: WebSocketMessage) => void;
  onJourneyCompleted?: () => void;
  onOpen?: () => void;
  onReconnect?: () => void;
  autoReconnect?: boolean;
}

export function useWebSocket({
  url,
  onMessage,
  onJourneyCompleted,
  onOpen,
  onReconnect,
  autoReconnect = true,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  // Keep latest callbacks in refs so caller re-renders never trigger reconnects
  const optionsRef = useRef({
    onMessage,
    onJourneyCompleted,
    onOpen,
    onReconnect,
    autoReconnect,
  });

  useEffect(() => {
    optionsRef.current = {
      onMessage,
      onJourneyCompleted,
      onOpen,
      onReconnect,
      autoReconnect,
    };
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<any>(null);
  const heartbeatIntervalRef = useRef<any>(null);
  const isTerminatedRef = useRef<boolean>(false);
  const isInitialConnectionRef = useRef<boolean>(true);

  const cleanupSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!url || isTerminatedRef.current) return;

    // Resolve full WebSocket URL
    let fullUrl = url;
    if (url.startsWith('/')) {
      const explicitWs = import.meta.env.VITE_WS_URL;
      if (explicitWs) {
        fullUrl = `${explicitWs.replace(/\/$/, '')}${url}`;
      } else {
        const customApi = getApiBaseUrl();
        if (customApi) {
          const wsProto = customApi.startsWith('https:') ? 'wss:' : 'ws:';
          const host = customApi.replace(/^https?:\/\//, '').replace(/\/$/, '');
          fullUrl = `${wsProto}//${host}${url}`;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          fullUrl = `${protocol}//${window.location.host}${url}`;
        }
      }
    }

    try {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        const wasReconnect = !isInitialConnectionRef.current;
        reconnectAttemptsRef.current = 0;

        // Trigger onOpen / onReconnect callbacks for REST state resynchronization
        if (wasReconnect && optionsRef.current.onReconnect) {
          optionsRef.current.onReconnect();
        } else if (optionsRef.current.onOpen) {
          optionsRef.current.onOpen();
        }
        isInitialConnectionRef.current = false;

        // Ping heartbeat every 25s
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const parsed = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(parsed);
          if (optionsRef.current.onMessage) {
            optionsRef.current.onMessage(parsed);
          }

          if (parsed.type === 'JOURNEY_COMPLETED') {
            isTerminatedRef.current = true;
            if (optionsRef.current.onJourneyCompleted) {
              optionsRef.current.onJourneyCompleted();
            }
          }
        } catch (e) {
          console.debug('Failed to parse WebSocket payload:', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

        // Code 4410: journey concluded or token revoked -> permanent termination, NEVER reconnect
        if (event.code === 4410) {
          isTerminatedRef.current = true;
          if (optionsRef.current.onJourneyCompleted) {
            optionsRef.current.onJourneyCompleted();
          }
          return;
        }

        // Unlimited exponential backoff with jitter capped at 30 seconds
        if (optionsRef.current.autoReconnect && !isTerminatedRef.current) {
          const attempts = reconnectAttemptsRef.current;
          const baseDelay = Math.min(1000 * Math.pow(1.5, attempts), 28000);
          const jitter = Math.random() * 2000;
          const delay = Math.min(baseDelay + jitter, 30000);

          reconnectAttemptsRef.current += 1;
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (err) => {
        console.debug('WebSocket stream notice:', err);
      };
    } catch (e) {
      console.debug('Failed to establish WebSocket connection:', e);
    }
  }, [url]);

  // Main lifecycle effect: strictly depends ONLY on url
  useEffect(() => {
    isTerminatedRef.current = false;
    isInitialConnectionRef.current = true;
    reconnectAttemptsRef.current = 0;
    connect();

    // Reconnect on network online or tab visibility change
    const handleReactivation = () => {
      if (document.visibilityState === 'visible' && !isTerminatedRef.current) {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connect();
        }
      }
    };

    window.addEventListener('online', handleReactivation);
    document.addEventListener('visibilitychange', handleReactivation);

    return () => {
      window.removeEventListener('online', handleReactivation);
      document.removeEventListener('visibilitychange', handleReactivation);
      cleanupSocket();
    };
  }, [url, connect, cleanupSocket]);

  const sendMessage = useCallback((msg: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }, []);

  return {
    isConnected,
    lastMessage,
    sendMessage,
  };
}
