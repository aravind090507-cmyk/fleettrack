import { useEffect, useCallback } from 'react';
import { locationApi } from '../services/api';
import { offlineStorage } from '../services/offlineStorage';
import { useDriverStore } from '../store/driverStore';

export function useOfflineSync(journeyId: string | null) {
  const { isOnline, setOnlineStatus, setOfflineQueueCount } = useDriverStore();

  const syncPendingRecords = useCallback(async () => {
    if (!journeyId || !navigator.onLine) return;

    try {
      const pending = await offlineStorage.getPendingRecords(journeyId);
      if (pending.length === 0) {
        setOfflineQueueCount(0);
        return;
      }

      console.info(`Network restored! Flushing ${pending.length} offline GPS records...`);
      const pings = pending.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed,
        heading: p.heading,
        accuracy: p.accuracy,
        altitude: p.altitude || null,
        timestamp: p.timestamp,
      }));

      // Upload batch
      const result = await locationApi.uploadBatch(journeyId, pings);
      if (result.pings_processed > 0) {
        const ids = pending.map((p) => p.id!).filter(Boolean);
        await offlineStorage.markSynced(ids);
        console.info(`Successfully synced ${result.pings_processed} queued GPS pings.`);
      }

      const remaining = await offlineStorage.getPendingCount(journeyId);
      setOfflineQueueCount(remaining);
    } catch (e) {
      console.warn('Failed to flush offline GPS queue:', e);
    }
  }, [journeyId, setOfflineQueueCount]);

  useEffect(() => {
    const handleOnline = () => {
      setOnlineStatus(true);
      syncPendingRecords();
    };

    const handleOffline = () => {
      setOnlineStatus(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    if (journeyId && navigator.onLine) {
      syncPendingRecords();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [journeyId, setOnlineStatus, syncPendingRecords]);

  return { syncPendingRecords };
}
