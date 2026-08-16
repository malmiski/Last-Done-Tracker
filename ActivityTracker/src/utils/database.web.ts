import AsyncStorage from '@react-native-async-storage/async-storage';
import { Activity, activities as initialActivities } from '../data/activities';
import { ActivityEntry, Tag, activityDetails as initialActivityDetails } from '../data/activity-details';
import { makeLegacyPlaceholder, parseRefArray } from './imageRef';

const DB_NAME = 'activities_db';
const ACTIVITIES_STORE = 'activities';
const ENTRIES_STORE = 'entries';
const TAGS_STORE = 'tags';
const ENTRY_TAGS_STORE = 'entry_tags';
const META_STORE = 'app_meta';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

/** Mirrors the native guard: never hand more than this to the UI layer. */
const MAX_INLINE_BYTES = 8192;

export const DEFAULT_PAGE_SIZE = 30;

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4); // v4 adds app_meta + startDate index
    request.onupgradeneeded = (event: any) => {
      const upgradeDb = event.target.result as IDBDatabase;
      const transaction = event.target.transaction;

      if (!upgradeDb.objectStoreNames.contains(ACTIVITIES_STORE)) {
        upgradeDb.createObjectStore(ACTIVITIES_STORE, { keyPath: 'id' });
      }

      let entriesStore: IDBObjectStore;
      if (!upgradeDb.objectStoreNames.contains(ENTRIES_STORE)) {
        entriesStore = upgradeDb.createObjectStore(ENTRIES_STORE, { keyPath: 'id' });
      } else {
        entriesStore = transaction.objectStore(ENTRIES_STORE);
      }
      if (!entriesStore.indexNames.contains('activityId')) {
        entriesStore.createIndex('activityId', 'activityId', { unique: false });
      }
      // Lets the entry list page in date order straight off the index instead
      // of loading every record and sorting in JS.
      if (!entriesStore.indexNames.contains('activityId_startDate')) {
        entriesStore.createIndex('activityId_startDate', ['activityId', 'startDate'], { unique: false });
      }
      if (!entriesStore.indexNames.contains('imagesMigrated')) {
        entriesStore.createIndex('imagesMigrated', 'imagesMigrated', { unique: false });
      }

      if (!upgradeDb.objectStoreNames.contains(TAGS_STORE)) {
        upgradeDb.createObjectStore(TAGS_STORE, { keyPath: 'id' });
      }
      if (!upgradeDb.objectStoreNames.contains(ENTRY_TAGS_STORE)) {
        const entryTagsStore = upgradeDb.createObjectStore(ENTRY_TAGS_STORE, { keyPath: ['entryId', 'tagId'] });
        entryTagsStore.createIndex('entryId', 'entryId', { unique: false });
        entryTagsStore.createIndex('tagId', 'tagId', { unique: false });
      }
      if (!upgradeDb.objectStoreNames.contains(META_STORE)) {
        upgradeDb.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
};

export const getDb = async () => {
  if (db) return db;
  db = await openDB();
  await migrateDatabase(db);
  await migrateFromAsyncStorage(db);
  await seedInitialData(db);
  return db;
};

/**
 * Normalise legacy shapes and stamp the `imagesMigrated` flag.
 *
 * This walks records with a cursor rather than `getAll()`. On a database full
 * of inline base64, `getAll()` would materialise every image at once — exactly
 * the failure mode this branch exists to remove.
 */
const migrateDatabase = async (database: IDBDatabase) => {
    const activities = await getAllFromStore<Activity>(database, ACTIVITIES_STORE);
    const needsMigration = activities.some(a => a.orderIndex === undefined);

    if (needsMigration) {
        console.log('Migrating IndexedDB activities: adding orderIndex...');
        const tx = database.transaction(ACTIVITIES_STORE, 'readwrite');
        const store = tx.objectStore(ACTIVITIES_STORE);
        for (let i = 0; i < activities.length; i++) {
            if (activities[i].orderIndex === undefined) {
                store.put({ ...activities[i], orderIndex: i });
            }
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    await new Promise<void>((resolve, reject) => {
        const tx = database.transaction([ENTRIES_STORE], 'readwrite');
        const store = tx.objectStore(ENTRIES_STORE);
        const request = store.openCursor();

        request.onsuccess = (event: any) => {
            const cursor = event.target.result as IDBCursorWithValue | null;
            if (!cursor) return;

            const entry = cursor.value;
            let needsUpdate = false;

            if (entry.date && !entry.startDate) {
                entry.startDate = entry.date;
                entry.endDate = entry.date;
                needsUpdate = true;
            }
            if (entry.image !== undefined && entry.images === undefined) {
                entry.images = parseRefArray(entry.image);
                delete entry.image;
                needsUpdate = true;
            }
            if (entry.thumbnail !== undefined && entry.thumbnails === undefined) {
                entry.thumbnails = parseRefArray(entry.thumbnail);
                delete entry.thumbnail;
                needsUpdate = true;
            }
            if (entry.imagesMigrated === undefined) {
                const hasAny =
                    (entry.images?.length ?? 0) > 0 || (entry.thumbnails?.length ?? 0) > 0;
                // Rows with no images need no conversion; rows with images are
                // assumed to be inline base64 until the migration proves
                // otherwise, which it does cheaply by inspecting the prefix.
                const alreadyRefs = [...(entry.images ?? []), ...(entry.thumbnails ?? [])].every(
                    (value: string) => typeof value === 'string' && value.startsWith('img:'),
                );
                entry.imagesMigrated = !hasAny || alreadyRefs ? 1 : 0;
                needsUpdate = true;
            }

            if (needsUpdate) cursor.update(entry);
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const initDatabase = async () => {
  await getDb();
};

const seedInitialData = async (database: IDBDatabase) => {
    const activities = await getAllFromStore<Activity>(database, ACTIVITIES_STORE);
    if (activities.length === 0) {
        console.log('Seeding initial data to IndexedDB...');
        const tx = database.transaction([ACTIVITIES_STORE, ENTRIES_STORE], 'readwrite');
        for (let i = 0; i < initialActivities.length; i++) {
            const activity = initialActivities[i];
            tx.objectStore(ACTIVITIES_STORE).add({ ...activity, orderIndex: i });
            const entries = initialActivityDetails[activity.id] || [];
            for (const entry of entries) {
                tx.objectStore(ENTRIES_STORE).add({
                    ...entry,
                    activityId: activity.id,
                    startDate: toIso(entry.startDate),
                    endDate: toIso(entry.endDate),
                    imagesMigrated: 1,
                });
            }
        }
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};

const migrateFromAsyncStorage = async (database: IDBDatabase) => {
    try {
        const storedActivities = await AsyncStorage.getItem(ACTIVITIES_KEY);
        if (storedActivities) {
            console.log('Migrating data from AsyncStorage to IndexedDB...');
            const activities: Activity[] = JSON.parse(storedActivities);
            const storedActivityDetails = await AsyncStorage.getItem(ACTIVITY_DETAILS_KEY);
            const activityDetails: { [key: string]: ActivityEntry[] } = storedActivityDetails
                ? JSON.parse(storedActivityDetails)
                : {};

            const tx = database.transaction([ACTIVITIES_STORE, ENTRIES_STORE], 'readwrite');
            for (let i = 0; i < activities.length; i++) {
                const activity = activities[i];
                tx.objectStore(ACTIVITIES_STORE).put({ ...activity, orderIndex: i });
                const entries = activityDetails[activity.id] || [];
                for (const entry of entries) {
                    tx.objectStore(ENTRIES_STORE).put({
                        ...entry,
                        activityId: activity.id,
                        startDate: toIso(entry.startDate),
                        endDate: toIso(entry.endDate),
                        imagesMigrated: 0,
                    });
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

const toIso = (value: any): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const getAllFromStore = <T>(database: IDBDatabase, storeName: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/* ------------------------------------------------------------------ *
 * Projection
 *
 * Records are converted to light objects the moment they come off the cursor.
 * Oversized legacy values are swapped for a placeholder and the original
 * string is dropped immediately, so at most one image's worth of base64 is
 * reachable at a time instead of an entire activity's worth.
 * ------------------------------------------------------------------ */

const guardRefs = (value: any, entryId: string): string[] | undefined => {
  const refs = parseRefArray(value);
  if (!refs || refs.length === 0) return undefined;
  const total = refs.reduce((sum, ref) => sum + ref.length, 0);
  if (total > MAX_INLINE_BYTES) return [makeLegacyPlaceholder(entryId)];
  return refs;
};

const projectEntry = (row: any): ActivityEntry & { activityId: string } => {
  const rawImages = row.images ?? row.image;
  const rawThumbnails = row.thumbnails ?? row.thumbnail;
  return {
    id: row.id,
    activityId: row.activityId,
    startDate: new Date(row.startDate ?? row.date),
    endDate: new Date(row.endDate ?? row.startDate ?? row.date),
    notes: row.notes ?? undefined,
    images: guardRefs(rawImages, row.id),
    thumbnails: guardRefs(rawThumbnails, row.id),
    hasImages: (parseRefArray(rawImages)?.length ?? 0) > 0,
    imagesMigrated: row.imagesMigrated === 1,
    tags: [],
  };
};

/**
 * Walk an activity's entries newest-first using the compound index, projecting
 * as we go and stopping as soon as the page is full.
 */
const collectEntries = async (
  database: IDBDatabase,
  {
    activityId,
    limit,
    offset,
    search,
    entryIds,
  }: {
    activityId?: string;
    limit: number;
    offset: number;
    search?: string;
    entryIds?: Set<string>;
  },
): Promise<(ActivityEntry & { activityId: string })[]> => {
  const term = search?.trim().toLowerCase();
  const results: (ActivityEntry & { activityId: string })[] = [];
  let skipped = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);

    let request: IDBRequest;
    if (activityId !== undefined && store.indexNames.contains('activityId_startDate')) {
      const range = IDBKeyRange.bound([activityId, ''], [activityId, '￿']);
      request = store.index('activityId_startDate').openCursor(range, 'prev');
    } else if (activityId !== undefined) {
      request = store.index('activityId').openCursor(activityId);
    } else {
      request = store.openCursor();
    }

    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
      if (!cursor || results.length >= limit) return resolve();

      const raw = cursor.value;
      const matchesId = !entryIds || entryIds.has(raw.id);
      const matchesTerm = !term || String(raw.notes ?? '').toLowerCase().includes(term);

      if (matchesId && matchesTerm) {
        if (skipped < offset) {
          skipped += 1;
        } else {
          results.push(projectEntry(raw));
        }
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  // The compound index is unavailable on freshly upgraded databases in some
  // browsers until the next open; sort defensively.
  results.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return results;
};

const attachTags = async (
  database: IDBDatabase,
  entries: (ActivityEntry & { activityId: string })[],
): Promise<void> => {
  if (entries.length === 0) return;

  const tagsById = new Map<string, Tag>();
  (await getAllFromStore<Tag>(database, TAGS_STORE)).forEach(tag => tagsById.set(tag.id, tag));

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRY_TAGS_STORE, 'readonly');
    const index = tx.objectStore(ENTRY_TAGS_STORE).index('entryId');
    let pending = entries.length;

    entries.forEach(entry => {
      const request = index.getAll(entry.id);
      request.onsuccess = () => {
        request.result.forEach((association: any) => {
          const tag = tagsById.get(association.tagId);
          if (tag) entry.tags!.push(tag);
        });
        pending -= 1;
        if (pending === 0) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
};

/* ------------------------------------------------------------------ *
 * Activities
 * ------------------------------------------------------------------ */

export const getActivities = async (): Promise<Activity[]> => {
  const database = await getDb();
  const activities = await getAllFromStore<Activity>(database, ACTIVITIES_STORE);
  return activities.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
};

export const addActivity = async (activity: Activity): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction(ACTIVITIES_STORE, 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).add(activity);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateActivity = async (activity: Activity): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction(ACTIVITIES_STORE, 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).put(activity);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateActivitiesOrder = async (activities: Activity[]): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction(ACTIVITIES_STORE, 'readwrite');
      const store = tx.objectStore(ACTIVITIES_STORE);
      for (const activity of activities) {
          store.put(activity);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const deleteActivity = async (id: string): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction([ACTIVITIES_STORE, ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      tx.objectStore(ACTIVITIES_STORE).delete(id);

      const entriesStore = tx.objectStore(ENTRIES_STORE);
      const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
      const index = entriesStore.index('activityId');
      const request = index.getAllKeys(id);
      request.onsuccess = () => {
          request.result.forEach(key => {
            entriesStore.delete(key);
            const entryTagsIndex = entryTagsStore.index('entryId');
            const associationRequest = entryTagsIndex.getAllKeys(key);
            associationRequest.onsuccess = () => {
                associationRequest.result.forEach(associationKey => entryTagsStore.delete(associationKey));
            };
          });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

/* ------------------------------------------------------------------ *
 * Entry reads
 * ------------------------------------------------------------------ */

export interface EntryPageOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export const getEntriesPage = async (
  activityId: string,
  { limit = DEFAULT_PAGE_SIZE, offset = 0, search }: EntryPageOptions = {},
): Promise<(ActivityEntry & { activityId: string })[]> => {
  const database = await getDb();
  const entries = await collectEntries(database, { activityId, limit, offset, search });
  await attachTags(database, entries);
  return entries;
};

export const countEntries = async (activityId: string, search?: string): Promise<number> => {
  const database = await getDb();
  const term = search?.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const index = tx.objectStore(ENTRIES_STORE).index('activityId');

    if (!term) {
      const request = index.count(activityId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      return;
    }

    let count = 0;
    const request = index.openCursor(activityId);
    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
      if (!cursor) return resolve(count);
      if (String(cursor.value.notes ?? '').toLowerCase().includes(term)) count += 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
};

export const getLatestEntry = async (
  activityId: string,
): Promise<(ActivityEntry & { activityId: string }) | null> => {
  const database = await getDb();
  const entries = await collectEntries(database, { activityId, limit: 1, offset: 0 });
  if (entries.length === 0) return null;
  await attachTags(database, entries);
  return entries[0];
};

export const getLatestEntryPerActivity = async (): Promise<Record<string, ActivityEntry & { activityId: string }>> => {
  const database = await getDb();
  const activities = await getActivities();
  const result: Record<string, ActivityEntry & { activityId: string }> = {};
  for (const activity of activities) {
    const latest = await getLatestEntry(activity.id);
    if (latest) result[activity.id] = latest;
  }
  return result;
};

export const getEntryDates = async (
  activityId: string,
): Promise<{ id: string; startDate: Date; endDate: Date }[]> => {
  const database = await getDb();
  const dates: { id: string; startDate: Date; endDate: Date }[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const request = tx.objectStore(ENTRIES_STORE).index('activityId').openCursor(activityId);
    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();
      const row = cursor.value;
      // Only the three fields are retained; the record itself is not kept.
      dates.push({
        id: row.id,
        startDate: new Date(row.startDate ?? row.date),
        endDate: new Date(row.endDate ?? row.startDate ?? row.date),
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  return dates.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
};

export const getEntryById = async (
  entryId: string,
): Promise<(ActivityEntry & { activityId: string }) | null> => {
  const database = await getDb();
  const row = await new Promise<any>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const request = tx.objectStore(ENTRIES_STORE).get(entryId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!row) return null;

  // Single row: safe to surface the real references even if still legacy.
  const entry: ActivityEntry & { activityId: string } = {
    id: row.id,
    activityId: row.activityId,
    startDate: new Date(row.startDate ?? row.date),
    endDate: new Date(row.endDate ?? row.startDate ?? row.date),
    notes: row.notes ?? undefined,
    images: parseRefArray(row.images ?? row.image),
    thumbnails: parseRefArray(row.thumbnails ?? row.thumbnail),
    hasImages: (parseRefArray(row.images ?? row.image)?.length ?? 0) > 0,
    imagesMigrated: row.imagesMigrated === 1,
    tags: [],
  };
  await attachTags(database, [entry]);
  return entry;
};

export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const database = await getDb();
  const entries = await collectEntries(database, {
    activityId,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  });
  await attachTags(database, entries);
  return entries;
};

export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const database = await getDb();
  const entries = await collectEntries(database, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  await attachTags(database, entries);
  return entries;
};

export const getAllImageRefs = async (): Promise<Set<string>> => {
  const database = await getDb();
  const refs = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const request = tx.objectStore(ENTRIES_STORE).openCursor();
    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();
      const row = cursor.value;
      [...(parseRefArray(row.images ?? row.image) ?? []),
       ...(parseRefArray(row.thumbnails ?? row.thumbnail) ?? [])]
        .filter(ref => ref.startsWith('img:'))
        .forEach(ref => refs.add(ref));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  return refs;
};

/**
 * References held by a single entry. Deleting a record does not delete its
 * blobs — they live in a separate object store — so callers read the refs
 * first, delete the record, then delete the blobs.
 */
export const getImageRefsForEntry = async (entryId: string): Promise<string[]> => {
  const raw = await getRawEntryImages(entryId);
  if (!raw) return [];
  return [...new Set([...raw.images, ...raw.thumbnails])].filter(ref => ref.startsWith('img:'));
};

/** References held by every entry of an activity, for cascading deletes. */
export const getImageRefsForActivity = async (activityId: string): Promise<string[]> => {
  const database = await getDb();
  const refs = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const request = tx.objectStore(ENTRIES_STORE).index('activityId').openCursor(activityId);
    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();
      const row = cursor.value;
      [...(parseRefArray(row.images ?? row.image) ?? []),
       ...(parseRefArray(row.thumbnails ?? row.thumbnail) ?? [])]
        .filter(ref => ref.startsWith('img:'))
        .forEach(ref => refs.add(ref));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });

  return [...refs];
};

/** Remove every entry (and therefore every image) but keep the activities. */
export const deleteAllEntries = async (): Promise<void> => {
  const database = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
    tx.objectStore(ENTRIES_STORE).clear();
    tx.objectStore(ENTRY_TAGS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const activities = await getActivities();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ACTIVITIES_STORE, 'readwrite');
    const store = tx.objectStore(ACTIVITIES_STORE);
    activities.forEach(activity => store.put({ ...activity, lastDone: 'Never' }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/* ------------------------------------------------------------------ *
 * Entry writes
 * ------------------------------------------------------------------ */

export const addEntry = async (activityId: string, entry: ActivityEntry): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      tx.objectStore(ENTRIES_STORE).add({
        id: entry.id,
        activityId,
        startDate: toIso(entry.startDate),
        endDate: toIso(entry.endDate),
        notes: entry.notes ?? null,
        images: entry.images ?? null,
        thumbnails: entry.thumbnails ?? null,
        imagesMigrated: 1,
      });
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

export const updateEntryImages = async (id: string, images?: string[], thumbnails?: string[]): Promise<void> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(ENTRIES_STORE, 'readwrite');
        const store = tx.objectStore(ENTRIES_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            const entry = request.result;
            if (entry) {
                entry.images = images ?? null;
                entry.thumbnails = thumbnails ?? null;
                entry.imagesMigrated = 1;
                delete entry.image;
                delete entry.thumbnail;
                store.put(entry);
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const updateEntry = async (entry: ActivityEntry): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      const getRequest = store.get(entry.id);
      getRequest.onsuccess = () => {
          const existing = getRequest.result;
          if (!existing) return;

          store.put({
            id: entry.id,
            activityId: existing.activityId,
            startDate: toIso(entry.startDate),
            endDate: toIso(entry.endDate),
            notes: entry.notes ?? null,
            images: entry.images ?? null,
            thumbnails: entry.thumbnails ?? null,
            imagesMigrated: 1,
          });

          const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
          const index = entryTagsStore.index('entryId');
          const clearRequest = index.getAllKeys(entry.id);
          clearRequest.onsuccess = () => {
              clearRequest.result.forEach(key => entryTagsStore.delete(key));
              if (entry.tags) {
                  entry.tags.forEach(tag => {
                      entryTagsStore.add({ entryId: entry.id, tagId: tag.id });
                  });
              }
          };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const updateEntryDetails = async (
  entry: Pick<ActivityEntry, 'id' | 'startDate' | 'endDate' | 'notes' | 'tags'>,
): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      const getRequest = store.get(entry.id);
      getRequest.onsuccess = () => {
          const existing = getRequest.result;
          if (!existing) return;
          // Images are left exactly as they are.
          existing.startDate = toIso(entry.startDate);
          existing.endDate = toIso(entry.endDate);
          existing.notes = entry.notes ?? null;
          store.put(existing);

          const entryTagsStore = tx.objectStore(ENTRY_TAGS_STORE);
          const index = entryTagsStore.index('entryId');
          const clearRequest = index.getAllKeys(entry.id);
          clearRequest.onsuccess = () => {
              clearRequest.result.forEach(key => entryTagsStore.delete(key));
              if (entry.tags) {
                  entry.tags.forEach(tag => entryTagsStore.add({ entryId: entry.id, tagId: tag.id }));
              }
          };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
  });
};

export const deleteEntry = async (id: string): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
      const tx = database.transaction([ENTRIES_STORE, ENTRY_TAGS_STORE], 'readwrite');
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

/* ------------------------------------------------------------------ *
 * Image migration bookkeeping
 * ------------------------------------------------------------------ */

export const getMeta = async (key: string): Promise<string | null> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readonly');
    const request = tx.objectStore(META_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
};

export const setMeta = async (key: string, value: string): Promise<void> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const countUnmigratedEntries = async (): Promise<number> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);
    if (!store.indexNames.contains('imagesMigrated')) return resolve(0);
    const request = store.index('imagesMigrated').count(0);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getUnmigratedEntryIds = async (limit: number): Promise<string[]> => {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const store = tx.objectStore(ENTRIES_STORE);
    if (!store.indexNames.contains('imagesMigrated')) return resolve([]);
    // getAllKeys on the index avoids deserialising the records themselves,
    // so the base64 never enters memory during discovery.
    const request = store.index('imagesMigrated').getAllKeys(0, limit);
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error);
  });
};

export const getRawEntryImages = async (
  entryId: string,
): Promise<{ images: string[]; thumbnails: string[] } | null> => {
  const database = await getDb();
  const row = await new Promise<any>((resolve, reject) => {
    const tx = database.transaction(ENTRIES_STORE, 'readonly');
    const request = tx.objectStore(ENTRIES_STORE).get(entryId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!row) return null;
  return {
    images: parseRefArray(row.images ?? row.image) ?? [],
    thumbnails: parseRefArray(row.thumbnails ?? row.thumbnail) ?? [],
  };
};

export const markEntryMigrated = async (
  entryId: string,
  images: string[],
  thumbnails: string[],
): Promise<void> => updateEntryImages(entryId, images, thumbnails);

/** IndexedDB reclaims space on its own; nothing to do. */
export const compactDatabase = async (): Promise<void> => {};

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

export const getTags = async (): Promise<Tag[]> => {
    const database = await getDb();
    const tags = await getAllFromStore<Tag>(database, TAGS_STORE);
    return tags.sort((a, b) => a.name.localeCompare(b.name));
};

export const addTag = async (tag: Tag): Promise<void> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(TAGS_STORE, 'readwrite');
        tx.objectStore(TAGS_STORE).add(tag);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const updateTag = async (tag: Tag): Promise<void> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(TAGS_STORE, 'readwrite');
        tx.objectStore(TAGS_STORE).put(tag);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteTag = async (id: string): Promise<void> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction([TAGS_STORE, ENTRY_TAGS_STORE], 'readwrite');
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

export const getEntryTags = async (entryId: string): Promise<Tag[]> => {
    const database = await getDb();
    const tagsById = new Map<string, Tag>();
    (await getAllFromStore<Tag>(database, TAGS_STORE)).forEach(tag => tagsById.set(tag.id, tag));

    return new Promise((resolve, reject) => {
        const tx = database.transaction(ENTRY_TAGS_STORE, 'readonly');
        const request = tx.objectStore(ENTRY_TAGS_STORE).index('entryId').getAll(entryId);
        request.onsuccess = () => {
            resolve(request.result.map((row: any) => tagsById.get(row.tagId)).filter(Boolean) as Tag[]);
        };
        request.onerror = () => reject(request.error);
    });
};

export const addEntryTag = async (entryId: string, tagId: string): Promise<void> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(ENTRY_TAGS_STORE, 'readwrite');
        tx.objectStore(ENTRY_TAGS_STORE).put({ entryId, tagId });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getTagUsageCount = async (tagId: string): Promise<number> => {
    const database = await getDb();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(ENTRY_TAGS_STORE, 'readonly');
        const request = tx.objectStore(ENTRY_TAGS_STORE).index('tagId').count(tagId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const entryIdsForTags = async (database: IDBDatabase, tagIds: string[]): Promise<Set<string>> => {
  const ids = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(ENTRY_TAGS_STORE, 'readonly');
    const index = tx.objectStore(ENTRY_TAGS_STORE).index('tagId');
    let pending = tagIds.length;
    if (pending === 0) return resolve();

    tagIds.forEach(tagId => {
      const request = index.getAll(tagId);
      request.onsuccess = () => {
        request.result.forEach((row: any) => ids.add(row.entryId));
        pending -= 1;
        if (pending === 0) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  return ids;
};

export const getEntriesByTag = async (
  tagId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<(ActivityEntry & { activityId: string })[]> => getEntriesByTags([tagId], options);

export const getEntriesByTags = async (
  tagIds: string[],
  { limit = DEFAULT_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<(ActivityEntry & { activityId: string })[]> => {
    const database = await getDb();
    if (tagIds.length === 0) return [];

    const entryIds = await entryIdsForTags(database, tagIds);
    if (entryIds.size === 0) return [];

    const entries = await collectEntries(database, { limit, offset, entryIds });
    await attachTags(database, entries);
    return entries;
};

export const countEntriesByTags = async (tagIds: string[]): Promise<number> => {
    const database = await getDb();
    if (tagIds.length === 0) return 0;
    return (await entryIdsForTags(database, tagIds)).size;
};

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

export const exportDatabase = async () => {
    alert('Use "Export backup" to download a portable .zip of your data.');
};

export const importDatabase = async () => {
    alert('Use "Import backup" to restore from a .zip.');
};
