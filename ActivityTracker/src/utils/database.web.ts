import AsyncStorage from '@react-native-async-storage/async-storage';
import { Activity, activities as initialActivities } from '../data/activities';
import { ActivityEntry, Tag, activityDetails as initialActivityDetails } from '../data/activity-details';

const DB_NAME = 'activities_db';
const ACTIVITIES_STORE = 'activities';
const ENTRIES_STORE = 'entries';
const TAGS_STORE = 'tags';
const ENTRY_TAGS_STORE = 'entry_tags';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3); // Bumped version for new stores
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
      if (!db.objectStoreNames.contains(TAGS_STORE)) {
        db.createObjectStore(TAGS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ENTRY_TAGS_STORE)) {
        const entryTagsStore = db.createObjectStore(ENTRY_TAGS_STORE, { keyPath: ['entryId', 'tagId'] });
        entryTagsStore.createIndex('entryId', 'entryId', { unique: false });
        entryTagsStore.createIndex('tagId', 'tagId', { unique: false });
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
      const tx = db.transaction([ACTIVITIES_STORE, ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).delete(id);

      const entriesStore = tx.objectStore(ENTRIES_STORE);
      const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
      const index = entriesStore.index('activityId');
      const request = index.getAllKeys(id);
      request.onsuccess = () => {
          request.result.forEach(key => {
            entriesStore.delete(key);
            // Manual cascade for entry_tags
            const entryTagsIndex = entryTagsStore.index('entryId');
            const etReq = entryTagsIndex.getAllKeys(key);
            etReq.onsuccess = () => {
                etReq.result.forEach(etKey => entryTagsStore.delete(etKey));
            };
          });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

const fetchTagsForEntries = async (db: IDBDatabase, entries: any[]): Promise<any[]> => {
    const tx = db.transaction([TAGS_STORE, ENTRY_TAGS_STORE], 'readonly');
    const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
    const tagsStore = tx.objectStore(TAGS_STORE);
    const entryTagsIndex = entryTagsStore.index('entryId');

    const results = [];
    for (const row of entries) {
        const tagAssociations = await new Promise<any[]>((res) => {
            const req = entryTagsIndex.getAll(row.id);
            req.onsuccess = () => res(req.result);
        });
        const tags = [];
        for (const assoc of tagAssociations) {
            const tag = await new Promise<Tag | undefined>((res) => {
                const req = tagsStore.get(assoc.tagId);
                req.onsuccess = () => res(req.result);
            });
            if (tag) tags.push(tag);
        }
        results.push({
            ...row,
            startDate: new Date(row.startDate || row.date),
            endDate: new Date(row.endDate || row.date),
            tags: tags,
        });
    }
    return results;
};

export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const db = await getDb();
  const rows = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);
    const index = store.index('activityId');
    const request = index.getAll(activityId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const results = await fetchTagsForEntries(db, rows);
  results.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return results;
};

export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const db = await getDb();
  const rows = await getAllFromStore<any>(db, ENTRIES_STORE);
  return await fetchTagsForEntries(db, rows);
};

export const addEntry = async (activityId: string, entry: ActivityEntry): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      tx.objectStore(ENTRIES_STORE).add({ ...entry, activityId });
      if (entry.tags) {
          const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
          entry.tags.forEach(tag => {
              entryTagsStore.add({ entryId: entry.id, tagId: tag.id });
          });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateEntry = async (entry: ActivityEntry): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      const getReq = store.get(entry.id);
      getReq.onsuccess = () => {
          if (getReq.result) {
              store.put({ ...entry, activityId: getReq.result.activityId });

              const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
              const index = entryTagsStore.index('entryId');
              const clearReq = index.getAllKeys(entry.id);
              clearReq.onsuccess = () => {
                  clearReq.result.forEach(key => entryTagsStore.delete(key));
                  if (entry.tags) {
                      entry.tags.forEach(tag => {
                          entryTagsStore.add({ entryId: entry.id, tagId: tag.id });
                      });
                  }
              };
          }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const deleteEntry = async (id: string): Promise<void> => {
  const db = await getDb();
  return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      tx.objectStore(ENTRIES_STORE).delete(id);

      const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
      const index = entryTagsStore.index('entryId');
      const request = index.getAllKeys(id);
      request.onsuccess = () => {
          request.result.forEach(key => entryTagsStore.delete(key));
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

// Tag CRUD
export const getTags = async (): Promise<Tag[]> => {
    const db = await getDb();
    const tags = await getAllFromStore<Tag>(db, TAGS_STORE);
    return tags.sort((a, b) => a.name.localeCompare(b.name));
};

export const addTag = async (tag: Tag): Promise<void> => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(TAGS_STORE, 'readwrite');
        tx.objectStore(TAGS_STORE).add(tag);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const updateTag = async (tag: Tag): Promise<void> => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(TAGS_STORE, 'readwrite');
        tx.objectStore(TAGS_STORE).put(tag);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteTag = async (id: string): Promise<void> => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([TAGS_STORE, ENTRY_TAGS_STORE], 'readwrite');
        tx.objectStore(TAGS_STORE).delete(id);

        const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
        const index = entryTagsStore.index('tagId');
        const request = index.getAllKeys(id);
        request.onsuccess = () => {
            request.result.forEach(key => entryTagsStore.delete(key));
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// Tag associations
export const getEntryTags = async (entryId: string): Promise<Tag[]> => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([TAGS_STORE, ENTRY_TAGS_STORE], 'readonly');
        const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
        const tagsStore = tx.objectStore(TAGS_STORE);
        const index = entryTagsStore.index('entryId');
        const request = index.getAll(entryId);
        request.onsuccess = async () => {
            const tagIds = request.result.map(row => row.tagId);
            const tags = [];
            for (const tagId of tagIds) {
                const tagReq = tagsStore.get(tagId);
                const tag = await new Promise<Tag | undefined>((res) => {
                    tagReq.onsuccess = () => res(tagReq.result);
                });
                if (tag) tags.push(tag);
            }
            resolve(tags);
        };
        request.onerror = () => reject(request.error);
    });
};

export const getTagUsageCount = async (tagId: string): Promise<number> => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ENTRY_TAGS_STORE, 'readonly');
        const store = tx.objectStore(ENTRY_TAGS_STORE);
        const index = store.index('tagId');
        const request = index.count(tagId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const getEntriesByTag = async (tagId: string): Promise<(ActivityEntry & { activityId: string })[]> => {
    const db = await getDb();
    const entryIds = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(ENTRY_TAGS_STORE, 'readonly');
        const store = tx.objectStore(ENTRY_TAGS_STORE);
        const index = store.index('tagId');
        const request = index.getAll(tagId);
        request.onsuccess = () => resolve(request.result.map(r => r.entryId));
        request.onerror = () => reject(request.error);
    });

    if (entryIds.length === 0) return [];

    const entriesStore = db.transaction(ENTRIES_STORE, 'readonly').objectStore(ENTRIES_STORE);
    const entryRows = [];
    for (const entryId of entryIds) {
        const row = await new Promise<any>((res) => {
            const req = entriesStore.get(entryId);
            req.onsuccess = () => res(req.result);
        });
        if (row) entryRows.push(row);
    }

    const results = await fetchTagsForEntries(db, entryRows);
    results.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    return results;
};


export const exportDatabase = async () => {
    alert('Database export is not supported on web.');
};

export const importDatabase = async () => {
    alert('Database import is not supported on web.');
};
