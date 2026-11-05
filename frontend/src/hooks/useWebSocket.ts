import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketMessage } from '../types';
import { getApiBaseUrl } from '../services/api';

interface UseWebSocketOptions {
  url: string | null;
  onMessage?: (msg: WebSocketMessage) => void;
  onJourneyCompleted?: () => void;
  autoReconnect?: boolean;
}

export function useWebSocket({
  url,
  onMessage,
  onJourneyCompleted,
  autoReconnect = true,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<any>(null);
  const heartbeatIntervalRef = useRef<any>(null);
  const isTerminatedRef = useRef<boolean>(false);

  const connect = useCallback(() => {
    if (!url || isTerminatedRef.current) return;

    // Resolve full WebSocket URL (supports GitHub Pages, Vercel, or local proxy)
    let fullUrl = url;
    if (url.startsWith('/')) {
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

    try {
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Start ping heartbeat
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
          if (onMessage) onMessage(parsed);

          if (parsed.type === 'JOURNEY_COMPLETED') {
            isTerminatedRef.current = true;
            if (onJourneyCompleted) onJourneyCompleted();
          }
        } catch (e) {
          console.error('Failed to parse WebSocket payload:', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

        if (event.code === 4410) {
          isTerminatedRef.current = true;
          if (onJourneyCompleted) onJourneyCompleted();
          return;
        }

        if (autoReconnect && !isTerminatedRef.current && reconnectAttemptsRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket stream error:', err);
      };
    } catch (e) {
      console.error('Failed to establish WebSocket connection:', e);
    }
  }, [autoReconnect, onJourneyCompleted, onMessage, url]);

  useEffect(() => {
    isTerminatedRef.current = false;
    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

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
