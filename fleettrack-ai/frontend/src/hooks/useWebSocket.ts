import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useVehicleStore } from '../store/vehicleStore';
import { useNotificationStore } from '../store/notificationStore';
import { VehicleLocation, Notification } from '../types';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export function useWebSocket() {
  const token = useAuthStore((state) => state.token);
  const updateLocation = useVehicleStore((state) => state.updateLocation);
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const subscribedVehicleIdsRef = useRef<Set<string>>(new Set());

  const getWsUrl = useCallback(() => {
    const rawWsUrl = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000';
    // Ensure protocol matches ws:// or wss://
    let baseUrl = rawWsUrl;
    if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'ws://');
    } else if (baseUrl.startsWith('https://')) {
      baseUrl = baseUrl.replace('https://', 'wss://');
    }
    return `${baseUrl}/ws/tracking?token=${encodeURIComponent(token || '')}`;
  }, [token]);

  const connect = useCallback(() => {
    if (!token) {
      setConnectionStatus('disconnected');
      setIsConnected(false);
      return;
    }

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        // Re-subscribe any vehicle IDs if we had previous subscriptions
        if (subscribedVehicleIdsRef.current.size > 0) {
          const ids = Array.from(subscribedVehicleIdsRef.current);
          ws.send(JSON.stringify({ action: 'subscribe', vehicle_ids: ids }));
        }

        // Start 30s ping interval to keep connection alive
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Check if it's a vehicle location update
          if (data.type === 'location' || (data.latitude !== undefined && data.longitude !== undefined && data.vehicle_id)) {
            const location: VehicleLocation = {
              vehicle_id: data.vehicle_id,
              latitude: Number(data.latitude),
              longitude: Number(data.longitude),
              speed: Number(data.speed || 0),
              heading: Number(data.heading || 0),
              recorded_at: data.recorded_at || new Date().toISOString(),
              is_simulated: !!data.is_simulated,
            };
            updateLocation(location);
          } else if (data.type === 'notification' || data.event_type) {
            // Real-time notification received
            const notif: Notification = {
              id: data.id || `ws-${Date.now()}-${Math.random()}`,
              user_id: data.user_id || '',
              vehicle_id: data.vehicle_id,
              event_type: data.event_type || 'alert',
              message: data.message || '',
              is_read: false,
              created_at: data.created_at || new Date().toISOString(),
            };
            addNotification(notif);
          }
        } catch {
          // Ignore non-JSON or ping/pong messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        // Auto reconnect with exponential backoff up to 30s
        const attempts = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempts), 30000);
        setConnectionStatus('reconnecting');
        reconnectAttemptsRef.current += 1;

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setConnectionStatus('disconnected');
      setIsConnected(false);
    }
  }, [token, getWsUrl, updateLocation, addNotification]);

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  const subscribe = useCallback((vehicleIds: string[]) => {
    vehicleIds.forEach((id) => subscribedVehicleIdsRef.current.add(id));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'subscribe',
          vehicle_ids: vehicleIds,
        })
      );
    }
  }, []);

  const unsubscribe = useCallback((vehicleIds: string[]) => {
    vehicleIds.forEach((id) => subscribedVehicleIdsRef.current.delete(id));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'unsubscribe',
          vehicle_ids: vehicleIds,
        })
      );
    }
  }, []);

  useEffect(() => {
    if (token) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [token, connect, disconnect]);

  return {
    isConnected,
    connectionStatus,
    subscribe,
    unsubscribe,
  };
}

export default useWebSocket;
