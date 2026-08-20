import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { Activity, activities as initialActivities } from '../data/activities';
import { ActivityEntry, Tag, activityDetails as initialActivityDetails } from '../data/activity-details';
import { makeLegacyPlaceholder, parseRefArray, serialiseRefArray } from './imageRef';

const DB_NAME = 'activities.db';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

/**
 * Values longer than this are never pulled into JS by a list query. A migrated
 * row holds an array of ~20-byte refs, so even 100 images stay well under it,
 * while a single legacy base64 blob blows past it immediately.
 */
const MAX_INLINE_SELECT_BYTES = 8192;

/** Rows fetched per page by the entry list. */
export const DEFAULT_PAGE_SIZE = 30;

let dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

export const getDb = async () => {
  if (Platform.OS === 'web') return null;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);

        await db.execAsync(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            lastDone TEXT,
            icon TEXT,
            orderIndex INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY NOT NULL,
            activityId TEXT NOT NULL,
            startDate TEXT NOT NULL,
            endDate TEXT NOT NULL,
            notes TEXT,
            image TEXT,
            thumbnail TEXT,
            FOREIGN KEY (activityId) REFERENCES activities (id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS entry_tags (
            entryId TEXT NOT NULL,
            tagId TEXT NOT NULL,
            PRIMARY KEY (entryId, tagId),
            FOREIGN KEY (entryId) REFERENCES entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
        /*
         * Natural pixel size of a stored image, keyed by its reference.
         *
         * Derived data: every value here can be read back out of the file's
         * own header. It is cached because the entry list needs to know how
         * tall a row will be *before* it renders it, and a header read is
         * asynchronous. Keyed by reference rather than stored on the entry
         * because two entries can share an image after a copy and paste.
         *
         * Because it is rebuildable, a missing row is not an error and
         * backups do not carry it.
         */
        CREATE TABLE IF NOT EXISTS image_dimensions (
            ref TEXT PRIMARY KEY NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL
        );
        `);

        await migrateDatabase(db);
        await migrateFromAsyncStorage(db);
        await seedInitialData(db);
        return db;
    } catch (error) {
        console.error('Failed to open database', error);
        return null;
    }
  })();

  return dbPromise;
};

export const initDatabase = async () => {
  await getDb();
};

const migrateDatabase = async (db: SQLite.SQLiteDatabase) => {
  try {
    const tableInfo = await db.getAllAsync<any>("PRAGMA table_info(entries)");
    const hasDate = tableInfo.some(col => col.name === 'date');
    const hasStartDate = tableInfo.some(col => col.name === 'startDate');
    const hasThumbnail = tableInfo.some(col => col.name === 'thumbnail');
    const hasImagesMigrated = tableInfo.some(col => col.name === 'imagesMigrated');

    if (hasDate && !hasStartDate) {
      console.log('Migrating entries table: adding startDate and endDate...');
      await db.execAsync('ALTER TABLE entries ADD COLUMN startDate TEXT');
      await db.execAsync('ALTER TABLE entries ADD COLUMN endDate TEXT');
      await db.execAsync('UPDATE entries SET startDate = date, endDate = date');
      // Note: Dropping columns is not supported in older SQLite versions,
      // but we can leave 'date' as it's now redundant.
    }

    if (!hasThumbnail) {
      console.log('Migrating entries table: adding thumbnail...');
      await db.execAsync('ALTER TABLE entries ADD COLUMN thumbnail TEXT');
    }

    // Marks rows whose image columns hold short references rather than inline
    // base64. Explicit bookkeeping beats guessing from string length.
    if (!hasImagesMigrated) {
      console.log('Migrating entries table: adding imagesMigrated...');
      await db.execAsync('ALTER TABLE entries ADD COLUMN imagesMigrated INTEGER NOT NULL DEFAULT 0');
      // Rows with no image data at all need no conversion.
      await db.execAsync(`
        UPDATE entries SET imagesMigrated = 1
        WHERE (image IS NULL OR image = '') AND (thumbnail IS NULL OR thumbnail = '')
      `);
    }

    const activitiesTableInfo = await db.getAllAsync<any>("PRAGMA table_info(activities)");
    const hasOrderIndex = activitiesTableInfo.some(col => col.name === 'orderIndex');
    if (!hasOrderIndex) {
      console.log('Migrating activities table: adding orderIndex...');
      await db.execAsync('ALTER TABLE activities ADD COLUMN orderIndex INTEGER DEFAULT 0');
      const rows = await db.getAllAsync<any>("SELECT id FROM activities");
      for (let i = 0; i < rows.length; i++) {
        await db.runAsync('UPDATE activities SET orderIndex = ? WHERE id = ?', [i, rows[i].id]);
      }
    }

    const tables = await db.getAllAsync<any>("SELECT name FROM sqlite_master WHERE type='table'");
    const hasTags = tables.some(t => t.name === 'tags');
    if (!hasTags) {
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS entry_tags (
                entryId TEXT NOT NULL,
                tagId TEXT NOT NULL,
                PRIMARY KEY (entryId, tagId),
                FOREIGN KEY (entryId) REFERENCES entries (id) ON DELETE CASCADE,
                FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE
            );
        `);
    }

    // Paging and search both order by startDate within an activity; without
    // this index every page does a full scan plus a sort of the whole table.
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_entries_activity_start
        ON entries (activityId, startDate DESC);
      CREATE INDEX IF NOT EXISTS idx_entries_migration
        ON entries (imagesMigrated);
      CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags (entryId);
      CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags (tagId);
    `);
  } catch (error) {
    console.error('Error during database migration:', error);
  }
};

const seedInitialData = async (db: SQLite.SQLiteDatabase) => {
    const activitiesCount = await db.getFirstAsync<{count: number}>('SELECT COUNT(*) as count FROM activities');
    if (activitiesCount?.count === 0) {
        console.log('Seeding initial data...');
        for (let i = 0; i < initialActivities.length; i++) {
            const activity = initialActivities[i];
            await db.runAsync(
                'INSERT INTO activities (id, name, lastDone, icon, orderIndex) VALUES (?, ?, ?, ?, ?)',
                [activity.id, activity.name, activity.lastDone, activity.icon, i]
            );
            const entries = initialActivityDetails[activity.id] || [];
            for (const entry of entries) {
                await db.runAsync(
                    'INSERT INTO entries (id, activityId, startDate, endDate, notes, image, imagesMigrated) VALUES (?, ?, ?, ?, ?, ?, 1)',
                    [entry.id, activity.id, entry.startDate.toISOString(), entry.endDate.toISOString(), entry.notes || null, serialiseRefArray(entry.images)]
                );
            }
        }
    }
}

const migrateFromAsyncStorage = async (db: SQLite.SQLiteDatabase) => {
  try {
    const storedActivities = await AsyncStorage.getItem(ACTIVITIES_KEY);
    if (storedActivities) {
      console.log('Migrating data from AsyncStorage to SQLite...');
      const activities: Activity[] = JSON.parse(storedActivities);
      const storedActivityDetails = await AsyncStorage.getItem(ACTIVITY_DETAILS_KEY);
      const activityDetails: { [key: string]: ActivityEntry[] } = storedActivityDetails
        ? JSON.parse(storedActivityDetails)
        : {};

      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        await db.runAsync(
          'INSERT OR REPLACE INTO activities (id, name, lastDone, icon, orderIndex) VALUES (?, ?, ?, ?, ?)',
          [activity.id, activity.name, activity.lastDone, activity.icon, i]
        );

        const entries = activityDetails[activity.id] || [];
        for (const entry of entries) {
          const entryDate = new Date(entry.startDate || (entry as any).date).toISOString();
          // Images arriving from AsyncStorage are inline base64, so they are
          // left flagged for the image migration to convert.
          await db.runAsync(
            'INSERT OR REPLACE INTO entries (id, activityId, startDate, endDate, notes, image, imagesMigrated) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [entry.id, activity.id, entryDate, entryDate, entry.notes || null, serialiseRefArray(entry.images) ?? (entry as any).image ?? null]
          );
        }
      }

      // After successful migration, clear AsyncStorage to prevent re-migration
      await AsyncStorage.removeItem(ACTIVITIES_KEY);
      await AsyncStorage.removeItem(ACTIVITY_DETAILS_KEY);
      console.log('Migration complete.');
    }
  } catch (error) {
    console.error('Error during migration:', error);
  }
};

export const getActivities = async (): Promise<Activity[]> => {
  const db = await getDb();
  if (!db) return []; // Should not happen with Metro resolving to .web.ts
  return await db.getAllAsync<Activity>('SELECT * FROM activities ORDER BY orderIndex ASC');
};

export const addActivity = async (activity: Activity) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO activities (id, name, lastDone, icon, orderIndex) VALUES (?, ?, ?, ?, ?)',
    [activity.id, activity.name, activity.lastDone, activity.icon, activity.orderIndex]
  );
};

export const updateActivity = async (activity: Activity) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE activities SET name = ?, lastDone = ?, icon = ?, orderIndex = ? WHERE id = ?',
    [activity.name, activity.lastDone, activity.icon, activity.orderIndex, activity.id]
  );
};

export const updateActivitiesOrder = async (activities: Activity[]) => {
  const db = await getDb();
  if (!db) return;
  await db.withTransactionAsync(async () => {
    for (const activity of activities) {
      await db.runAsync(
        'UPDATE activities SET orderIndex = ? WHERE id = ?',
        [activity.orderIndex, activity.id]
      );
    }
  });
};

export const deleteActivity = async (id: string) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM activities WHERE id = ?', [id]);
};

/* ------------------------------------------------------------------ *
 * Entry reads
 *
 * The projection below is the heart of the memory fix. `entries.image` is
 * never selected unguarded: on an unmigrated row it holds hundreds of
 * kilobytes of base64, and selecting it for a whole activity was what pushed
 * the app past 3GB. Instead:
 *   - values under MAX_INLINE_SELECT_BYTES come through as-is (refs, and
 *     small legacy thumbnails, which are safe)
 *   - anything larger is replaced by a "legacy:<id>" placeholder, which the
 *     UI renders as an empty tile until the image migration converts the row
 * ------------------------------------------------------------------ */

const ENTRY_LIST_PROJECTION = `
  entries.id                AS id,
  entries.activityId        AS activityId,
  entries.startDate         AS startDate,
  entries.endDate           AS endDate,
  entries.notes             AS notes,
  entries.imagesMigrated    AS imagesMigrated,
  CASE
    WHEN entries.thumbnail IS NULL OR entries.thumbnail = '' THEN NULL
    WHEN length(entries.thumbnail) <= ${MAX_INLINE_SELECT_BYTES} THEN entries.thumbnail
    ELSE 'legacy:' || entries.id
  END                       AS thumbnail,
  CASE
    WHEN entries.image IS NULL OR entries.image = '' THEN NULL
    WHEN length(entries.image) <= ${MAX_INLINE_SELECT_BYTES} THEN entries.image
    ELSE 'legacy:' || entries.id
  END                       AS image,
  CASE WHEN entries.image IS NULL OR entries.image = '' THEN 0 ELSE 1 END AS hasImages
`;

const mapEntryRow = (row: any): ActivityEntry & { activityId: string } => {
  const images = parseRefArray(row.image);
  const thumbnails = parseRefArray(row.thumbnail);
  return {
    id: row.id,
    activityId: row.activityId,
    startDate: new Date(row.startDate),
    endDate: new Date(row.endDate),
    notes: row.notes ?? undefined,
    images,
    thumbnails,
    hasImages: row.hasImages === 1,
    imagesMigrated: row.imagesMigrated === 1,
    tags: [],
  };
};

/** Attach tags to a page of entries with one query rather than one per row. */
const attachTags = async (
  db: SQLite.SQLiteDatabase,
  entries: (ActivityEntry & { activityId: string })[],
): Promise<void> => {
  if (entries.length === 0) return;
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const placeholders = entries.map(() => '?').join(',');

  const rows = await db.getAllAsync<any>(
    `SELECT entry_tags.entryId AS entryId, tags.id AS id, tags.name AS name, tags.color AS color
     FROM entry_tags
     JOIN tags ON tags.id = entry_tags.tagId
     WHERE entry_tags.entryId IN (${placeholders})`,
    entries.map(entry => entry.id),
  );

  rows.forEach(row => {
    byId.get(row.entryId)?.tags!.push({ id: row.id, name: row.name, color: row.color });
  });
};

export interface EntryPageOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * One page of entries for an activity, newest first. Search is pushed into SQL
 * so filtering a large activity never materialises the whole history in JS.
 */
export const getEntriesPage = async (
  activityId: string,
  { limit = DEFAULT_PAGE_SIZE, offset = 0, search }: EntryPageOptions = {},
): Promise<(ActivityEntry & { activityId: string })[]> => {
  const db = await getDb();
  if (!db) return [];

  const term = search?.trim();
  const where = term
    ? 'WHERE entries.activityId = ? AND entries.notes LIKE ? ESCAPE \'\\\''
    : 'WHERE entries.activityId = ?';
  const params: any[] = term
    ? [activityId, `%${escapeLike(term)}%`, limit, offset]
    : [activityId, limit, offset];

  const rows = await db.getAllAsync<any>(
    `SELECT ${ENTRY_LIST_PROJECTION}
     FROM entries
     ${where}
     ORDER BY entries.startDate DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  const entries = rows.map(mapEntryRow);
  await attachTags(db, entries);
  return entries;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

export const countEntries = async (activityId: string, search?: string): Promise<number> => {
  const db = await getDb();
  if (!db) return 0;
  const term = search?.trim();
  const result = term
    ? await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM entries WHERE activityId = ? AND notes LIKE ? ESCAPE \'\\\'',
        [activityId, `%${escapeLike(term)}%`],
      )
    : await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM entries WHERE activityId = ?',
        [activityId],
      );
  return result?.count ?? 0;
};

/** The most recent entry for an activity — used by the activity list tiles. */
export const getLatestEntry = async (
  activityId: string,
): Promise<(ActivityEntry & { activityId: string }) | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<any>(
    `SELECT ${ENTRY_LIST_PROJECTION}
     FROM entries WHERE entries.activityId = ?
     ORDER BY entries.startDate DESC LIMIT 1`,
    [activityId],
  );
  if (!row) return null;
  const entry = mapEntryRow(row);
  await attachTags(db, [entry]);
  return entry;
};

/** Latest entry for every activity in one query — no N+1 at app start. */
export const getLatestEntryPerActivity = async (): Promise<Record<string, ActivityEntry & { activityId: string }>> => {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.getAllAsync<any>(`
    SELECT ${ENTRY_LIST_PROJECTION}
    FROM entries
    JOIN (
      SELECT activityId, MAX(startDate) AS maxStart
      FROM entries GROUP BY activityId
    ) latest
      ON latest.activityId = entries.activityId
     AND latest.maxStart   = entries.startDate
    GROUP BY entries.activityId
  `);
  const entries = rows.map(mapEntryRow);
  await attachTags(db, entries);
  return Object.fromEntries(entries.map(entry => [entry.activityId, entry]));
};

/**
 * Dates only. GraphView needs thousands of timestamps and zero pixels, so it
 * must never touch the image columns.
 */
export const getEntryDates = async (
  activityId: string,
): Promise<{ id: string; startDate: Date; endDate: Date }[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(
    'SELECT id, startDate, endDate FROM entries WHERE activityId = ? ORDER BY startDate DESC',
    [activityId],
  );
  return rows.map(row => ({
    id: row.id,
    startDate: new Date(row.startDate),
    endDate: new Date(row.endDate),
  }));
};

/**
 * A single entry with its image references, for the edit screen.
 * This is the only read path that touches `entries.image` directly, and it is
 * scoped to exactly one row.
 */
export const getEntryById = async (
  entryId: string,
): Promise<(ActivityEntry & { activityId: string }) | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<any>(
    `SELECT id, activityId, startDate, endDate, notes, image, thumbnail, imagesMigrated,
            CASE WHEN image IS NULL OR image = '' THEN 0 ELSE 1 END AS hasImages
     FROM entries WHERE id = ?`,
    [entryId],
  );
  if (!row) return null;
  const entry = mapEntryRow(row);
  await attachTags(db, [entry]);
  return entry;
};

/**
 * Full history for one activity. Only used by CSV export, which walks
 * activities one at a time — never by the UI.
 */
export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(
    `SELECT ${ENTRY_LIST_PROJECTION}
     FROM entries WHERE entries.activityId = ?
     ORDER BY entries.startDate DESC`,
    [activityId],
  );
  const entries = rows.map(mapEntryRow);
  await attachTags(db, entries);
  return entries;
};

/**
 * Every entry, image columns projected safely. Used for garbage collection and
 * bulk operations. Still cheap because oversized values are replaced by
 * placeholders rather than loaded.
 */
export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(
    `SELECT ${ENTRY_LIST_PROJECTION} FROM entries`,
  );
  const entries = rows.map(mapEntryRow);
  await attachTags(db, entries);
  return entries;
};

/** Every managed reference currently in use — the live set for GC. */
export const getAllImageRefs = async (): Promise<Set<string>> => {
  const db = await getDb();
  const refs = new Set<string>();
  if (!db) return refs;
  const rows = await db.getAllAsync<any>(
    `SELECT
       CASE WHEN length(COALESCE(image,'')) <= ${MAX_INLINE_SELECT_BYTES} THEN image ELSE NULL END AS image,
       CASE WHEN length(COALESCE(thumbnail,'')) <= ${MAX_INLINE_SELECT_BYTES} THEN thumbnail ELSE NULL END AS thumbnail
     FROM entries`,
  );
  rows.forEach(row => {
    parseRefArray(row.image)?.forEach(ref => refs.add(ref));
    parseRefArray(row.thumbnail)?.forEach(ref => refs.add(ref));
  });
  return refs;
};

/**
 * References held by a single entry.
 *
 * Deleting a row does not delete its files — SQL knows nothing about the
 * filesystem — so callers read the refs first, delete the row, then delete the
 * blobs. Missing this step is how a file-backed store silently leaks disk.
 */
export const getImageRefsForEntry = async (entryId: string): Promise<string[]> => {
  const raw = await getRawEntryImages(entryId);
  if (!raw) return [];
  return [...new Set([...raw.images, ...raw.thumbnails])].filter(ref => ref.startsWith('img:'));
};

/** References held by every entry of an activity, for cascading deletes. */
export const getImageRefsForActivity = async (activityId: string): Promise<string[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(
    `SELECT
       CASE WHEN length(COALESCE(image,'')) <= ${MAX_INLINE_SELECT_BYTES} THEN image ELSE NULL END AS image,
       CASE WHEN length(COALESCE(thumbnail,'')) <= ${MAX_INLINE_SELECT_BYTES} THEN thumbnail ELSE NULL END AS thumbnail
     FROM entries WHERE activityId = ?`,
    [activityId],
  );
  const refs = new Set<string>();
  rows.forEach(row => {
    parseRefArray(row.image)?.forEach(ref => ref.startsWith('img:') && refs.add(ref));
    parseRefArray(row.thumbnail)?.forEach(ref => ref.startsWith('img:') && refs.add(ref));
  });
  return [...refs];
};

/** Remove every entry (and therefore every image) but keep the activities. */
export const deleteAllEntries = async (): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.execAsync('DELETE FROM entry_tags; DELETE FROM entries;');
  await db.runAsync("UPDATE activities SET lastDone = 'Never'");
};

/* ------------------------------------------------------------------ *
 * Entry writes
 * ------------------------------------------------------------------ */

export const addEntry = async (activityId: string, entry: ActivityEntry) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO entries (id, activityId, startDate, endDate, notes, image, thumbnail, imagesMigrated) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [
      entry.id,
      activityId,
      entry.startDate.toISOString(),
      entry.endDate.toISOString(),
      entry.notes || null,
      serialiseRefArray(entry.images),
      serialiseRefArray(entry.thumbnails),
    ],
  );
  if (entry.tags) {
    for (const tag of entry.tags) {
        await addEntryTag(entry.id, tag.id);
    }
  }
};

export const updateEntryImages = async (id: string, images?: string[], thumbnails?: string[]) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE entries SET image = ?, thumbnail = ?, imagesMigrated = 1 WHERE id = ?',
    [serialiseRefArray(images), serialiseRefArray(thumbnails), id],
  );
};

export const updateEntry = async (entry: ActivityEntry) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE entries SET startDate = ?, endDate = ?, notes = ?, image = ?, thumbnail = ?, imagesMigrated = 1 WHERE id = ?',
    [
      entry.startDate.toISOString(),
      entry.endDate.toISOString(),
      entry.notes || null,
      serialiseRefArray(entry.images),
      serialiseRefArray(entry.thumbnails),
      entry.id,
    ],
  );
  if (entry.tags) {
    await db.runAsync('DELETE FROM entry_tags WHERE entryId = ?', [entry.id]);
    for (const tag of entry.tags) {
        await addEntryTag(entry.id, tag.id);
    }
  }
};

/** Update everything except images — avoids rewriting refs needlessly. */
export const updateEntryDetails = async (
  entry: Pick<ActivityEntry, 'id' | 'startDate' | 'endDate' | 'notes' | 'tags'>,
) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE entries SET startDate = ?, endDate = ?, notes = ? WHERE id = ?',
    [entry.startDate.toISOString(), entry.endDate.toISOString(), entry.notes || null, entry.id],
  );
  if (entry.tags) {
    await db.runAsync('DELETE FROM entry_tags WHERE entryId = ?', [entry.id]);
    for (const tag of entry.tags) {
        await addEntryTag(entry.id, tag.id);
    }
  }
};

export const deleteEntry = async (id: string) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM entries WHERE id = ?', [id]);
};

/* ------------------------------------------------------------------ *
 * Image migration bookkeeping
 * ------------------------------------------------------------------ */

export const getMeta = async (key: string): Promise<string | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
};

export const setMeta = async (key: string, value: string): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
};

/** How many rows still hold inline base64. */
export const countUnmigratedEntries = async (): Promise<number> => {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM entries WHERE imagesMigrated = 0',
  );
  return row?.count ?? 0;
};

/** Ids only — the migration then loads one row's blobs at a time. */
export const getUnmigratedEntryIds = async (limit: number): Promise<string[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM entries WHERE imagesMigrated = 0 LIMIT ?',
    [limit],
  );
  return rows.map(row => row.id);
};

/**
 * Read one entry's raw image columns. Deliberately unguarded — this is the one
 * place that must see the legacy base64, and it handles a single row.
 */
export const getRawEntryImages = async (
  entryId: string,
): Promise<{ images: string[]; thumbnails: string[] } | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<any>(
    'SELECT image, thumbnail FROM entries WHERE id = ?',
    [entryId],
  );
  if (!row) return null;
  return {
    images: parseRefArray(row.image) ?? [],
    thumbnails: parseRefArray(row.thumbnail) ?? [],
  };
};

export const markEntryMigrated = async (
  entryId: string,
  images: string[],
  thumbnails: string[],
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE entries SET image = ?, thumbnail = ?, imagesMigrated = 1 WHERE id = ?',
    [serialiseRefArray(images), serialiseRefArray(thumbnails), entryId],
  );
};

/**
 * Reclaim the space freed by the migration. SQLite keeps deleted pages in the
 * file, so without this the database stays as large as it was even though the
 * base64 is gone.
 */
export const compactDatabase = async (): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.execAsync('VACUUM');
};

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

export const getTags = async (): Promise<Tag[]> => {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllAsync<Tag>('SELECT * FROM tags ORDER BY name ASC');
};

export const addTag = async (tag: Tag) => {
    const db = await getDb();
    if (!db) return;
    await db.runAsync('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [tag.id, tag.name, tag.color]);
};

export const updateTag = async (tag: Tag) => {
    const db = await getDb();
    if (!db) return;
    await db.runAsync('UPDATE tags SET name = ?, color = ? WHERE id = ?', [tag.name, tag.color, tag.id]);
};

export const deleteTag = async (id: string) => {
    const db = await getDb();
    if (!db) return;
    await db.runAsync('DELETE FROM tags WHERE id = ?', [id]);
};

export const getEntryTags = async (entryId: string): Promise<Tag[]> => {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllAsync<Tag>(
        'SELECT tags.* FROM tags JOIN entry_tags ON tags.id = entry_tags.tagId WHERE entry_tags.entryId = ?',
        [entryId]
    );
};

export const addEntryTag = async (entryId: string, tagId: string) => {
    const db = await getDb();
    if (!db) return;
    await db.runAsync('INSERT OR IGNORE INTO entry_tags (entryId, tagId) VALUES (?, ?)', [entryId, tagId]);
};

export const getTagUsageCount = async (tagId: string): Promise<number> => {
    const db = await getDb();
    if (!db) return 0;
    const result = await db.getFirstAsync<{count: number}>('SELECT COUNT(*) as count FROM entry_tags WHERE tagId = ?', [tagId]);
    return result?.count || 0;
};

export const getEntriesByTag = async (
  tagId: string,
  { limit = DEFAULT_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<(ActivityEntry & { activityId: string })[]> => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT ${ENTRY_LIST_PROJECTION}
       FROM entries
       JOIN entry_tags ON entry_tags.entryId = entries.id
       WHERE entry_tags.tagId = ?
       ORDER BY entries.startDate DESC
       LIMIT ? OFFSET ?`,
      [tagId, limit, offset],
    );

    const entries = rows.map(mapEntryRow);
    await attachTags(db, entries);
    return entries;
};

/** Entries carrying any of the given tags, de-duplicated, one page at a time. */
export const getEntriesByTags = async (
  tagIds: string[],
  { limit = DEFAULT_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<(ActivityEntry & { activityId: string })[]> => {
    const db = await getDb();
    if (!db || tagIds.length === 0) return [];

    const placeholders = tagIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<any>(
      `SELECT ${ENTRY_LIST_PROJECTION}
       FROM entries
       WHERE entries.id IN (
         SELECT DISTINCT entryId FROM entry_tags WHERE tagId IN (${placeholders})
       )
       ORDER BY entries.startDate DESC
       LIMIT ? OFFSET ?`,
      [...tagIds, limit, offset],
    );

    const entries = rows.map(mapEntryRow);
    await attachTags(db, entries);
    return entries;
};

export const countEntriesByTags = async (tagIds: string[]): Promise<number> => {
    const db = await getDb();
    if (!db || tagIds.length === 0) return 0;
    const placeholders = tagIds.map(() => '?').join(',');
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT entryId) as count FROM entry_tags WHERE tagId IN (${placeholders})`,
      tagIds,
    );
    return row?.count ?? 0;
};

/* ------------------------------------------------------------------ *
 * Raw database file access (used by the backup bundle)
 * ------------------------------------------------------------------ */

export const getDatabaseFile = (): File => new File(new Directory(Paths.document, 'SQLite'), DB_NAME);

/**
 * Share the raw .db file.
 *
 * Note: now that images live outside the database, this file on its own is no
 * longer a complete backup. `exportBundle` in utils/backup is the supported
 * path; this stays for anyone who specifically wants the database.
 */
export const exportDatabase = async () => {
  if (Platform.OS === 'web') {
    alert('Database export is not supported on web.');
    return;
  }

  try {
    const source = getDatabaseFile();
    if (!source.exists) {
      alert('Database file not found.');
      return;
    }

    const destination = new File(Paths.cache, DB_NAME);
    if (destination.exists) destination.delete();
    source.copy(destination);

    await Sharing.shareAsync(destination.uri);
  } catch (error) {
    console.error('Error exporting database:', error);
    alert('Failed to export database.');
  }
};

export const importDatabase = async () => {
  if (Platform.OS === 'web') {
    alert('Database import is not supported on web.');
    return;
  }

  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const selectedFile = new File(result.assets[0].uri);
    const dbDirectory = new Directory(Paths.document, 'SQLite');
    if (!dbDirectory.exists) {
      // Same typings/native mismatch guarded in imageStore.getDir().
      try {
        dbDirectory.create({ intermediates: true });
      } catch {
        dbDirectory.create();
      }
    }

    const destination = new File(dbDirectory, DB_NAME);
    if (destination.exists) destination.delete();
    selectedFile.copy(destination);

    // Reset the dbPromise so it reopens the new database
    dbPromise = null;

    alert('Database imported successfully.');
  } catch (error) {
    console.error('Error importing database:', error);
    alert('Failed to import database.');
  }
};

/* ------------------------------------------------------------------ *
 * Image dimensions
 *
 * A cache of what is already in each file's header, so the entry list can
 * work out a row's height without waiting on a read. See the table comment
 * in the schema above.
 * ------------------------------------------------------------------ */

export interface ImageDimensionRecord {
  ref: string;
  width: number;
  height: number;
}

/** Look up several at once; refs with no stored size are simply absent. */
export const getImageDimensions = async (
  refs: string[],
): Promise<Record<string, { width: number; height: number }>> => {
  const found: Record<string, { width: number; height: number }> = {};
  const db = await getDb();
  if (!db || refs.length === 0) return found;

  // SQLite caps how many parameters one statement may bind.
  const CHUNK = 200;
  try {
    for (let start = 0; start < refs.length; start += CHUNK) {
      const chunk = refs.slice(start, start + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await db.getAllAsync<any>(
        `SELECT ref, width, height FROM image_dimensions WHERE ref IN (${placeholders})`,
        chunk,
      );
      rows.forEach(row => {
        found[row.ref] = { width: row.width, height: row.height };
      });
    }
  } catch (error) {
    // Derived data: failing to read it costs a measurement, not correctness.
    console.warn('Could not read image dimensions', error);
  }

  return found;
};

export const putImageDimensions = async (records: ImageDimensionRecord[]): Promise<void> => {
  const db = await getDb();
  if (!db || records.length === 0) return;

  try {
    await db.withTransactionAsync(async () => {
      for (const record of records) {
        await db.runAsync(
          'INSERT OR REPLACE INTO image_dimensions (ref, width, height) VALUES (?, ?, ?)',
          record.ref,
          record.width,
          record.height,
        );
      }
    });
  } catch (error) {
    console.warn('Could not store image dimensions', error);
  }
};
