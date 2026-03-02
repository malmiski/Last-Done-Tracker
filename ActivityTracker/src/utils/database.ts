import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { Activity, activities as initialActivities } from '../data/activities';
import { ActivityEntry, Tag, activityDetails as initialActivityDetails } from '../data/activity-details';

const DB_NAME = 'activities.db';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

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
            icon TEXT
        );
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY NOT NULL,
            activityId TEXT NOT NULL,
            startDate TEXT NOT NULL,
            endDate TEXT NOT NULL,
            notes TEXT,
            image TEXT,
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

    if (hasDate && !hasStartDate) {
      console.log('Migrating entries table: adding startDate and endDate...');
      await db.execAsync('ALTER TABLE entries ADD COLUMN startDate TEXT');
      await db.execAsync('ALTER TABLE entries ADD COLUMN endDate TEXT');
      await db.execAsync('UPDATE entries SET startDate = date, endDate = date');
      // Note: Dropping columns is not supported in older SQLite versions,
      // but we can leave 'date' as it's now redundant.
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

  } catch (error) {
    console.error('Error during database migration:', error);
  }
};

const seedInitialData = async (db: SQLite.SQLiteDatabase) => {
    const activitiesCount = await db.getFirstAsync<{count: number}>('SELECT COUNT(*) as count FROM activities');
    if (activitiesCount?.count === 0) {
        console.log('Seeding initial data...');
        for (const activity of initialActivities) {
            await db.runAsync(
                'INSERT INTO activities (id, name, lastDone, icon) VALUES (?, ?, ?, ?)',
                [activity.id, activity.name, activity.lastDone, activity.icon]
            );
            const entries = initialActivityDetails[activity.id] || [];
            for (const entry of entries) {
                await db.runAsync(
                    'INSERT INTO entries (id, activityId, startDate, endDate, notes, image) VALUES (?, ?, ?, ?, ?, ?)',
                    [entry.id, activity.id, entry.startDate.toISOString(), entry.endDate.toISOString(), entry.notes || null, entry.image || null]
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

      for (const activity of activities) {
        await db.runAsync(
          'INSERT OR REPLACE INTO activities (id, name, lastDone, icon) VALUES (?, ?, ?, ?)',
          [activity.id, activity.name, activity.lastDone, activity.icon]
        );

        const entries = activityDetails[activity.id] || [];
        for (const entry of entries) {
          const entryDate = new Date(entry.startDate || (entry as any).date).toISOString();
          await db.runAsync(
            'INSERT OR REPLACE INTO entries (id, activityId, startDate, endDate, notes, image) VALUES (?, ?, ?, ?, ?, ?)',
            [entry.id, activity.id, entryDate, entryDate, entry.notes || null, entry.image || null]
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
  return await db.getAllAsync<Activity>('SELECT * FROM activities');
};

export const addActivity = async (activity: Activity) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO activities (id, name, lastDone, icon) VALUES (?, ?, ?, ?)',
    [activity.id, activity.name, activity.lastDone, activity.icon]
  );
};

export const updateActivity = async (activity: Activity) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE activities SET name = ?, lastDone = ?, icon = ? WHERE id = ?',
    [activity.name, activity.lastDone, activity.icon, activity.id]
  );
};

export const deleteActivity = async (id: string) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM activities WHERE id = ?', [id]);
};

const mapEntriesWithTags = (rows: any[]): ActivityEntry[] => {
    const entryMap = new Map<string, ActivityEntry>();
    rows.forEach(row => {
        if (!entryMap.has(row.id)) {
            entryMap.set(row.id, {
                id: row.id,
                startDate: new Date(row.startDate),
                endDate: new Date(row.endDate),
                notes: row.notes,
                image: row.image,
                tags: []
            });
        }
        if (row.tagId) {
            entryMap.get(row.id)!.tags!.push({
                id: row.tagId,
                name: row.tagName,
                color: row.tagColor
            });
        }
    });
    return Array.from(entryMap.values());
};

export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(`
    SELECT entries.*, tags.id as tagId, tags.name as tagName, tags.color as tagColor
    FROM entries
    LEFT JOIN entry_tags ON entries.id = entry_tags.entryId
    LEFT JOIN tags ON entry_tags.tagId = tags.id
    WHERE entries.activityId = ?
    ORDER BY entries.startDate DESC
  `, [activityId]);
  return mapEntriesWithTags(rows).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
};

export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<any>(`
    SELECT entries.*, tags.id as tagId, tags.name as tagName, tags.color as tagColor
    FROM entries
    LEFT JOIN entry_tags ON entries.id = entry_tags.entryId
    LEFT JOIN tags ON entry_tags.tagId = tags.id
  `);

  const entryMap = new Map<string, ActivityEntry & { activityId: string }>();
  rows.forEach(row => {
      if (!entryMap.has(row.id)) {
          entryMap.set(row.id, {
              id: row.id,
              activityId: row.activityId,
              startDate: new Date(row.startDate),
              endDate: new Date(row.endDate),
              notes: row.notes,
              image: row.image,
              tags: []
          });
      }
      if (row.tagId) {
          entryMap.get(row.id)!.tags!.push({
              id: row.tagId,
              name: row.tagName,
              color: row.tagColor
          });
      }
  });
  return Array.from(entryMap.values());
};

export const addEntry = async (activityId: string, entry: ActivityEntry) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO entries (id, activityId, startDate, endDate, notes, image) VALUES (?, ?, ?, ?, ?, ?)',
    [entry.id, activityId, entry.startDate.toISOString(), entry.endDate.toISOString(), entry.notes || null, entry.image || null]
  );
  if (entry.tags) {
    for (const tag of entry.tags) {
        await addEntryTag(entry.id, tag.id);
    }
  }
};

export const updateEntry = async (entry: ActivityEntry) => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'UPDATE entries SET startDate = ?, endDate = ?, notes = ?, image = ? WHERE id = ?',
    [entry.startDate.toISOString(), entry.endDate.toISOString(), entry.notes || null, entry.image || null, entry.id]
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

// Tag CRUD
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

// Tag associations
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

export const getEntriesByTag = async (tagId: string): Promise<(ActivityEntry & { activityId: string })[]> => {
    const db = await getDb();
    if (!db) return [];

    // Find entry IDs first
    const entryIdRows = await db.getAllAsync<{entryId: string}>('SELECT entryId FROM entry_tags WHERE tagId = ?', [tagId]);
    if (entryIdRows.length === 0) return [];
    const entryIds = entryIdRows.map(r => r.entryId);

    // Fetch entries and their tags
    const placeholders = entryIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<any>(`
        SELECT entries.*, tags.id as tagId, tags.name as tagName, tags.color as tagColor
        FROM entries
        LEFT JOIN entry_tags ON entries.id = entry_tags.entryId
        LEFT JOIN tags ON entry_tags.tagId = tags.id
        WHERE entries.id IN (${placeholders})
        ORDER BY entries.startDate DESC
    `, entryIds);

    const entryMap = new Map<string, ActivityEntry & { activityId: string }>();
    rows.forEach(row => {
        if (!entryMap.has(row.id)) {
            entryMap.set(row.id, {
                id: row.id,
                activityId: row.activityId,
                startDate: new Date(row.startDate),
                endDate: new Date(row.endDate),
                notes: row.notes,
                image: row.image,
                tags: []
            });
        }
        if (row.tagId) {
            entryMap.get(row.id)!.tags!.push({
                id: row.tagId,
                name: row.tagName,
                color: row.tagColor
            });
        }
    });
    return Array.from(entryMap.values()).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
};

export const exportDatabase = async () => {
  if (Platform.OS === 'web') {
    alert('Database export is not supported on web.');
    return;
  }

  const db = await getDb();
  if (!db) return;

  try {
    const dbUri = `${FileSystem.documentDirectory}SQLite/${DB_NAME}`;
    const fileInfo = await FileSystem.getInfoAsync(dbUri);
    if (!fileInfo.exists) {
      alert('Database file not found.');
      return;
    }

    const exportUri = `${FileSystem.cacheDirectory}${DB_NAME}`;
    await FileSystem.copyAsync({
      from: dbUri,
      to: exportUri,
    });

    await Sharing.shareAsync(exportUri);
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

    const selectedFile = result.assets[0];
    const dbUri = `${FileSystem.documentDirectory}SQLite/${DB_NAME}`;

    // Ensure the SQLite directory exists
    const dbDir = `${FileSystem.documentDirectory}SQLite`;
    const dirInfo = await FileSystem.getInfoAsync(dbDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
    }

    await FileSystem.copyAsync({
      from: selectedFile.uri,
      to: dbUri,
    });

    // Reset the dbPromise so it reopens the new database
    dbPromise = null;

    alert('Database imported successfully.');
  } catch (error) {
    console.error('Error importing database:', error);
    alert('Failed to import database.');
  }
};
