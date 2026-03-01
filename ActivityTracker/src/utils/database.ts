import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { Activity } from '../data/activities';
import { ActivityEntry } from '../data/activity-details';

const DB_NAME = 'activities.db';
const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

let db: SQLite.SQLiteDatabase;

export const initDatabase = async () => {
  db = await SQLite.openDatabaseAsync(DB_NAME);

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
      date TEXT NOT NULL,
      notes TEXT,
      image TEXT,
      FOREIGN KEY (activityId) REFERENCES activities (id) ON DELETE CASCADE
    );
  `);

  await migrateFromAsyncStorage();
};

const migrateFromAsyncStorage = async () => {
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
          await db.runAsync(
            'INSERT OR REPLACE INTO entries (id, activityId, date, notes, image) VALUES (?, ?, ?, ?, ?)',
            [entry.id, activity.id, new Date(entry.date).toISOString(), entry.notes || null, entry.image || null]
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
  return await db.getAllAsync<Activity>('SELECT * FROM activities');
};

export const addActivity = async (activity: Activity) => {
  await db.runAsync(
    'INSERT INTO activities (id, name, lastDone, icon) VALUES (?, ?, ?, ?)',
    [activity.id, activity.name, activity.lastDone, activity.icon]
  );
};

export const updateActivity = async (activity: Activity) => {
  await db.runAsync(
    'UPDATE activities SET name = ?, lastDone = ?, icon = ? WHERE id = ?',
    [activity.name, activity.lastDone, activity.icon, activity.id]
  );
};

export const deleteActivity = async (id: string) => {
  await db.runAsync('DELETE FROM activities WHERE id = ?', [id]);
};

export const getEntries = async (activityId: string): Promise<ActivityEntry[]> => {
  const rows = await db.getAllAsync<any>('SELECT * FROM entries WHERE activityId = ? ORDER BY date DESC', [activityId]);
  return rows.map(row => ({
    id: row.id,
    date: new Date(row.date),
    notes: row.notes,
    image: row.image,
  }));
};

export const getAllEntries = async (): Promise<(ActivityEntry & { activityId: string })[]> => {
  const rows = await db.getAllAsync<any>('SELECT * FROM entries');
  return rows.map(row => ({
    id: row.id,
    activityId: row.activityId,
    date: new Date(row.date),
    notes: row.notes,
    image: row.image,
  }));
};

export const addEntry = async (activityId: string, entry: ActivityEntry) => {
  await db.runAsync(
    'INSERT INTO entries (id, activityId, date, notes, image) VALUES (?, ?, ?, ?, ?)',
    [entry.id, activityId, entry.date.toISOString(), entry.notes || null, entry.image || null]
  );
};

export const updateEntry = async (entry: ActivityEntry) => {
  await db.runAsync(
    'UPDATE entries SET date = ?, notes = ?, image = ? WHERE id = ?',
    [entry.date.toISOString(), entry.notes || null, entry.image || null, entry.id]
  );
};

export const deleteEntry = async (id: string) => {
  await db.runAsync('DELETE FROM entries WHERE id = ?', [id]);
};

export const exportDatabase = async () => {
  if (Platform.OS === 'web') {
    alert('Database export is not supported on web.');
    return;
  }

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

    alert('Database imported successfully. Please restart the app to see changes.');
  } catch (error) {
    console.error('Error importing database:', error);
    alert('Failed to import database.');
  }
};
