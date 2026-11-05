import { openDB, DBSchema } from 'idb';
import { OfflineGPSRecord } from '../types';

interface FleetOfflineDB extends DBSchema {
  offline_gps_queue: {
    key: number;
    value: OfflineGPSRecord;
    indexes: {
      'by-journey': string;
      'by-synced': number;
    };
  };
}

const DB_NAME = 'fleet-offline-gps';
const DB_VERSION = 1;

export async function getDB() {
  return openDB<FleetOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('offline_gps_queue')) {
        const store = db.createObjectStore('offline_gps_queue', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by-journey', 'journey_id');
        store.createIndex('by-synced', 'synced');
      }
    },
  });
}

export const offlineStorage = {
  // Store a GPS reading while offline
  addRecord: async (record: Omit<OfflineGPSRecord, 'id' | 'synced'>): Promise<number> => {
    try {
      const db = await getDB();
      const id = await db.add('offline_gps_queue', {
        ...record,
        synced: false,
      });
      return id;
    } catch (e) {
      console.error('Failed to store offline GPS ping:', e);
      return -1;
    }
  },

  // Retrieve pending (unsynced) records for a journey
  getPendingRecords: async (journeyId: string): Promise<OfflineGPSRecord[]> => {
    try {
      const db = await getDB();
      const allRecords = await db.getAll('offline_gps_queue');
      return allRecords
        .filter((r) => r.journey_id === journeyId && !r.synced)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (e) {
      console.error('Failed to retrieve offline GPS records:', e);
      return [];
    }
  },

  // Mark records as successfully synced
  markSynced: async (ids: number[]): Promise<void> => {
    try {
      const db = await getDB();
      const tx = db.transaction('offline_gps_queue', 'readwrite');
      for (const id of ids) {
        await tx.store.delete(id);
      }
      await tx.done;
    } catch (e) {
      console.error('Failed to clean up synced records:', e);
    }
  },

  // Count pending records
  getPendingCount: async (journeyId: string): Promise<number> => {
    try {
      const pending = await offlineStorage.getPendingRecords(journeyId);
      return pending.length;
    } catch {
      return 0;
    }
  },
};
