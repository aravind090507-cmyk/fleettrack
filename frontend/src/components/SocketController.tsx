import React, { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTelematicsStore } from '../store/telematicsStore';
import { useFleetStore } from '../store/fleetStore';
import { useAuthStore } from '../store/authStore';
import { dashboardApi, devicesApi, positionsApi, getApiBaseUrl } from '../services/api';
import { Position, TelematicsEnvelope, WebSocketMessage } from '../types';

export const SocketController: React.FC = () => {
  const token = useAuthStore((state) => state.token);
  const {
    handleEnvelope,
    addPosition,
    addEvent,
    updateDevice,
    setDevices,
    setPositions,
    setSocketState,
  } = useTelematicsStore();
  const { updateVehiclePosition, setOverview, setActiveVehicles } = useFleetStore();

  // Construct WebSocket URL
  const wsUrl = React.useMemo(() => {
    if (!token) return null;
    const base = getApiBaseUrl();
    let wsHost = window.location.host;
    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    if (base.startsWith('http')) {
      const parsed = new URL(base);
      wsHost = parsed.host;
      wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    }

    return `${wsProtocol}//${wsHost}/ws/live-fleet?token=${encodeURIComponent(token)}`;
  }, [token]);

  // REST Resync function held in ref
  const resyncData = useCallback(async () => {
    try {
      const [devs, activeVehicles, overview, positionsResp] = await Promise.all([
        devicesApi.list().catch(() => []),
        dashboardApi.getActiveVehicles().catch(() => []),
        dashboardApi.getOverview().catch(() => null),
        positionsApi.list({ limit: 100 }).catch(() => ({ items: [] })),
      ]);

      if (devs && devs.length > 0) {
        setDevices(devs);
      }
      if (positionsResp && positionsResp.items && positionsResp.items.length > 0) {
        setPositions(positionsResp.items);
      }
      if (activeVehicles) {
        setActiveVehicles(activeVehicles);
      }
      if (overview) {
        setOverview(overview);
      }
    } catch (err) {
      console.warn('[SocketController] REST resync error:', err);
    }
  }, [setDevices, setPositions, setActiveVehicles, setOverview]);

  const resyncRef = useRef(resyncData);
  useEffect(() => {
    resyncRef.current = resyncData;
  }, [resyncData]);

  // Message dispatcher
  const handleMessage = useCallback(
    (msg: WebSocketMessage) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'ENVELOPE') {
        const envelope = msg as unknown as TelematicsEnvelope;
        handleEnvelope(envelope);

        // Also update legacy fleetStore activeVehicles if positions present
        if (envelope.positions) {
          for (const pos of envelope.positions) {
            updateVehiclePosition({
              vehicle_id: pos.device_id, // device_id is linked to vehicle
              latitude: pos.latitude,
              longitude: pos.longitude,
              speed: pos.speed,
              heading: pos.course,
              recorded_at: pos.device_time || pos.server_time,
            });
          }
        }
      } else if (msg.type === 'LOCATION_UPDATE') {
        const pos: Position = {
          id: msg.id || Date.now(),
          device_id: msg.device_id || msg.vehicle_id,
          journey_id: msg.journey_id,
          protocol: msg.protocol || 'osmand',
          server_time: msg.server_time || new Date().toISOString(),
          device_time: msg.timestamp || msg.recorded_at || new Date().toISOString(),
          fix_time: msg.timestamp || new Date().toISOString(),
          valid: true,
          outdated: false,
          latitude: msg.latitude,
          longitude: msg.longitude,
          altitude: msg.altitude || 0,
          speed: msg.speed || 0,
          course: msg.heading ?? msg.course ?? 0,
          accuracy: msg.accuracy || 10,
          distance_m: msg.distance_m || 0,
          total_distance_m: msg.total_distance_m || 0,
          motion: msg.speed > 2,
          geofence_ids: msg.geofence_ids || [],
          attributes: msg.attributes || {},
        };
        addPosition(pos);
        updateVehiclePosition({
          vehicle_id: msg.vehicle_id || msg.device_id,
          latitude: msg.latitude,
          longitude: msg.longitude,
          speed: msg.speed || 0,
          heading: msg.heading ?? msg.course ?? 0,
          recorded_at: msg.timestamp || msg.recorded_at || new Date().toISOString(),
        });
      } else if (msg.type === 'TRIP_EVENT') {
        addEvent({
          id: msg.id || String(Date.now()),
          type: msg.event_type || msg.type,
          event_time: msg.created_at || new Date().toISOString(),
          device_id: msg.device_id || msg.vehicle_id,
          journey_id: msg.journey_id,
          attributes: msg.metadata || {},
        });
      } else if (msg.type === 'DEVICE_STATUS') {
        if (msg.device_id && msg.status) {
          updateDevice({
            id: msg.device_id,
            status: msg.status,
          });
        }
      }
    },
    [handleEnvelope, addPosition, addEvent, updateDevice, updateVehiclePosition]
  );

  const onOpen = useCallback(() => {
    setSocketState({ connected: true, connecting: false, lastConnectedAt: new Date().toISOString() });
    resyncRef.current();
  }, [setSocketState]);

  const onReconnect = useCallback(() => {
    setSocketState({ connected: true, connecting: false, lastConnectedAt: new Date().toISOString() });
    resyncRef.current();
  }, [setSocketState]);

  useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    onOpen,
    onReconnect,
    autoReconnect: true,
  });

  // REST resync on window visibility change or online event
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resyncRef.current();
      }
    };
    const handleOnline = () => {
      resyncRef.current();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    // Initial resync on mount
    resyncRef.current();

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return null;
};
