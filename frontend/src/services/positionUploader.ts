import { LocationPing } from '../types';
import { locationApi } from './api';
import { offlineStorage, getDB } from './offlineStorage';

export interface UploaderState {
  queueDepth: number;
  lastAckAt: string | null;
  serverTimeOffsetMs: number;
  lastRejectionReasons: string[];
  isUploading: boolean;
}

type StateListener = (state: UploaderState) => void;

class PositionUploaderService {
  private isFlushing = false;
  private currentJourneyId: string | null = null;
  private backoffCount = 0;
  private retryTimeout: any = null;
  private listeners: Set<StateListener> = new Set();

  private state: UploaderState = {
    queueDepth: 0,
    lastAckAt: null,
    serverTimeOffsetMs: 0,
    lastRejectionReasons: [],
    isUploading: false,
  };

  public setJourneyId(journeyId: string | null) {
    if (this.currentJourneyId !== journeyId) {
      this.currentJourneyId = journeyId;
      this.backoffCount = 0;
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }
      if (journeyId) {
        this.refreshQueueDepth();
        this.triggerFlush();
      }
    }
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): UploaderState {
    return this.state;
  }

  private updateState(partial: Partial<UploaderState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[PositionUploader] listener error:', err);
      }
    }
  }

  public async refreshQueueDepth(): Promise<number> {
    if (!this.currentJourneyId) {
      this.updateState({ queueDepth: 0 });
      return 0;
    }
    const count = await offlineStorage.getPendingCount(this.currentJourneyId);
    this.updateState({ queueDepth: count });
    return count;
  }

  /**
   * Enqueue a GPS ping with write-ahead to IndexedDB, then trigger flush.
   */
  public async enqueue(journeyId: string, ping: LocationPing): Promise<void> {
    this.currentJourneyId = journeyId;

    // 1. Write-ahead to IndexedDB
    await offlineStorage.addRecord({
      journey_id: journeyId,
      latitude: ping.latitude,
      longitude: ping.longitude,
      speed: ping.speed,
      heading: ping.heading,
      accuracy: ping.accuracy,
      altitude: ping.altitude || undefined,
      timestamp: ping.timestamp,
    });

    await this.refreshQueueDepth();

    // 2. Trigger flush
    this.triggerFlush();
  }

  public triggerFlush() {
    if (this.isFlushing || !this.currentJourneyId || !navigator.onLine) {
      return;
    }
    this.flushLoop();
  }

  private async flushLoop() {
    if (this.isFlushing || !this.currentJourneyId) return;

    this.isFlushing = true;
    this.updateState({ isUploading: true });

    try {
      while (this.currentJourneyId && navigator.onLine) {
        // Fetch up to 200 pending pings in chronological order
        const records = await offlineStorage.getPendingRecords(this.currentJourneyId);
        if (!records || records.length === 0) {
          break;
        }

        const chunk = records.slice(0, 200);
        const pingsPayload: LocationPing[] = chunk.map((r) => ({
          latitude: r.latitude,
          longitude: r.longitude,
          speed: r.speed,
          heading: r.heading,
          accuracy: r.accuracy,
          altitude: r.altitude,
          timestamp: r.timestamp,
        }));

        const chunkIds = chunk.map((r) => r.id!).filter((id): id is number => typeof id === 'number');

        try {
          const response = await locationApi.uploadBatch(this.currentJourneyId, pingsPayload);
          const serverTime = (response as any)?.server_time;
          let offsetMs = this.state.serverTimeOffsetMs;

          if (serverTime) {
            const serverMs = new Date(serverTime).getTime();
            if (!isNaN(serverMs)) {
              offsetMs = Date.now() - serverMs;
            }
          }

          const results = (response as any)?.results as Array<{ index: number; status: string; reason?: string }> | undefined;
          const idsToDelete: number[] = [];
          const newRejections: string[] = [];

          if (results && Array.isArray(results) && results.length > 0) {
            for (const res of results) {
              const pingId = chunkIds[res.index];
              if (pingId !== undefined) {
                // Delete accepted AND permanently rejected points (they should not be retried)
                if (res.status === 'recorded' || res.status === 'accepted' || res.status === 'rejected' || res.status === 'filtered') {
                  idsToDelete.push(pingId);
                }
                if (res.reason && (res.status === 'rejected' || res.status === 'filtered')) {
                  newRejections.push(res.reason);
                }
              }
            }
          } else {
            // If backend didn't return per-point results, all 200 were processed
            idsToDelete.push(...chunkIds);
          }

          if (idsToDelete.length > 0) {
            await offlineStorage.markSynced(idsToDelete);
          }

          this.backoffCount = 0;
          const remaining = await this.refreshQueueDepth();

          this.updateState({
            lastAckAt: new Date().toISOString(),
            serverTimeOffsetMs: offsetMs,
            lastRejectionReasons: newRejections.length > 0 ? newRejections.slice(-5) : this.state.lastRejectionReasons,
            queueDepth: remaining,
          });

          // If all processed or queue empty, exit loop
          if (remaining === 0 || idsToDelete.length === 0) {
            break;
          }
        } catch (err: any) {
          // Check if journey was ended (409 or 410)
          if (err?.response?.status === 409 || err?.response?.status === 410) {
            console.warn('[PositionUploader] Journey ended on server. Purging local pending queue.');
            await offlineStorage.markSynced(chunkIds);
            await this.refreshQueueDepth();
            break;
          }

          // Network or server error: trigger exponential backoff
          this.backoffCount = Math.min(this.backoffCount + 1, 5);
          const delayMs = Math.min(30000, 1000 * Math.pow(2, this.backoffCount - 1));
          console.warn(`[PositionUploader] Batch upload failed, backing off for ${delayMs}ms:`, err?.message || err);

          if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
          }
          this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null;
            this.triggerFlush();
          }, delayMs);
          break;
        }
      }
    } finally {
      this.isFlushing = false;
      this.updateState({ isUploading: false });
    }
  }
}

export const positionUploader = new PositionUploaderService();
