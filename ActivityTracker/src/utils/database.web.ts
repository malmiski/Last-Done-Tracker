import AsyncStorage from '@react-native-async-storage/async-storage';
import { Activity, activities as initialActivities } from '../data/activities';
import { ActivityEntry, activityDetails as initialActivityDetails } from '../data/activity-details';

const DB_NAME = 'activities_db';
const ACTIVITIES_STORE = 'activities';
const ENTRIES_STORE = 'entries';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Bumped version for index
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(ACTIVITIES_STORE)) {
        db.createObjectStore(ACTIVITIES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const entriesStore = db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' });
        entriesStore.createIndex('activityId', 'activityId', { unique: false });
      } else {
        const entriesStore = event.target.transaction.objectStore(ENTRIES_STORE);
        if (!entriesStore.indexNames.contains('activityId')) {
            entriesStore.createIndex('activityId', 'activityId', { unique: false });
        }
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
};

export const getDb = async () => {
  if (db) return db;
  db = await openDB();
  await migrateFromAsyncStorage(db);
  await seedInitialData(db);
  return db;
};

export const initDatabase = async () => {
  await getDb();
};

const seedInitialData = async (db: IDBDatabase) => {
    const activities = await getAllFromStore<Activity>(db, ACTIVITIES_STORE);
    if (activities.length === 0) {
        console.log('Seeding initial data to IndexedDB...');
        const tx = db.transaction([ACTIVITIES_STORE, ENTRIES_STORE], 'readwrite');
        for (const activity of initialActivities) {
            tx.objectStore(ACTIVITIES_STORE).add(activity);
            const entries = initialActivityDetails[activity.id] || [];
            for (const entry of entries) {
                tx.objectStore(ENTRIES_STORE).add({ ...entry, activityId: activity.id });
            }
        }
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};

const migrateFromAsyncStorage = async (db: IDBDatabase) => {
    try {
        const storedActivities = await AsyncStorage.getItem(ACTIVITIES_KEY);
        if (storedActivities) {
            console.log('Migrating data from AsyncStorage to IndexedDB...');
            const activities: Activity[] = JSON.parse(storedActivities);
            const storedActivityDetails = await AsyncStorage.getItem(ACTIVITY_DETAILS_KEY);
            const activityDetails: { [key: string]: ActivityEntry[] } = storedActivityDetails
                ? JSON.parse(storedActivityDetails)
                : {};

            const tx = db.transaction([ACTIVITIES_STORE, ENTRIES_STORE], 'readwrite');
            for (const activity of activities) {
                tx.objectStore(ACTIVITIES_STORE).put(activity);
                const entries = activityDetails[activity.id] || [];
                for (const entry of entries) {
                    tx.objectStore(ENTRIES_STORE).put({ ...entry, activityId: activity.id });
                }
            }

            return new Promise<void>((resolve, reject) => {
                tx.oncomplete = async () => {
                    await AsyncStorage.removeItem(ACTIVITIES_KEY);
                    await AsyncStorage.removeItem(ACTIVITY_DETAILS_KEY);
                    console.log('Migration to IndexedDB complete.');
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            });
        }
    } catch (error) {
        console.error('Error during migration to IndexedDB:', error);
    }
};

const getAllFromStore = <T>(db: IDBDatabase, storeName: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getActivities = async (): Promise<Activity[]> => {
  const db = await getDb();
  return getAllFromStore<Activity>(db, ACTIVITIES_STORE);
};

export const addActivity = async (activity: Activity): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).add(activity);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateActivity = async (activity: Activity): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction(ACTIVITIES_STORE, 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).put(activity);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const deleteActivity = async (id: string): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction([ACTIVITIES_STORE, ENTRIES_STORE], 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).delete(id);

      const entriesStore = tx.objectStore(ENTRIES_STORE);
      const index = entriesStore.index('activityId');
      const request = index.getAllKeys(id);
      request.onsuccess = () => {
          request.result.forEach(key => entriesStore.delete(key));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);
    const index = store.index('activityId');
    const request = index.getAll(activityId);
    request.onsuccess = () => {
        const results = request.result.map(row => ({
            id: row.id,
            date: new Date(row.date),
            notes: row.notes,
            image: row.image,
        }));
        results.sort((a, b) => b.date.getTime() - a.date.getTime());
        resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const db = await getDb();
  const rows = await getAllFromStore<any>(db, ENTRIES_STORE);
  return rows.map(row => ({
    id: row.id,
    activityId: row.activityId,
    date: new Date(row.date),
    notes: row.notes,
    image: row.image,
  }));
};

export const addEntry = async (activityId: string, entry: ActivityEntry): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      tx.objectStore(ENTRIES_STORE).add({ ...entry, activityId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateEntry = async (entry: ActivityEntry): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      const getReq = store.get(entry.id);
      getReq.onsuccess = () => {
          if (getReq.result) {
              const putReq = store.put({ ...entry, activityId: getReq.result.activityId });
              putReq.onsuccess = () => resolve();
              putReq.onerror = () => reject(putReq.error);
          } else {
              resolve();
          }
      };
      getReq.onerror = () => reject(getReq.error);
  });
};

export const deleteEntry = async (id: string): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      tx.objectStore(ENTRIES_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const exportDatabase = async () => {
    alert('Database export is not supported on web.');
};

export const importDatabase = async () => {
    alert('Database import is not supported on web.');
};
