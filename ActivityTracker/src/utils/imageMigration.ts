/**
 * One-time conversion of inline base64 images into the image store.
 *
 * Constraints this is built around:
 *  - It must never load more than one entry's images at a time. Doing the
 *    obvious thing (select every unmigrated row, map over it) would reproduce
 *    the exact out-of-memory crash the migration exists to fix.
 *  - It must be resumable. A user who backgrounds the app halfway through
 *    should pick up where they left off, not start over.
 *  - It must yield to the UI. This runs in the background while the app is
 *    usable, so each entry is followed by a turn of the event loop.
 *  - It must be idempotent, and a row that cannot be converted must be marked
 *    so it is not retried forever.
 */
import { InteractionManager, Platform } from 'react-native';
import * as database from './database';
import * as imageStore from './imageStore';
import { FAILED_SENTINEL, isFileRef, isInlineBase64 } from './imageRef';

const MIGRATION_VERSION = '2';
const META_KEY_VERSION = 'imageMigration.version';
const META_KEY_COMPACTED = 'imageMigration.compacted';

/** Ids fetched per batch. Each is still processed one at a time. */
const BATCH_SIZE = 25;

/** Give the UI a frame between entries so scrolling stays smooth. */
const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export interface MigrationProgress {
  total: number;
  completed: number;
  failed: number;
  running: boolean;
  finished: boolean;
}

let progress: MigrationProgress = {
  total: 0,
  completed: 0,
  failed: 0,
  running: false,
  finished: false,
};

const listeners = new Set<(value: MigrationProgress) => void>();

const emit = (patch: Partial<MigrationProgress>) => {
  progress = { ...progress, ...patch };
  listeners.forEach(listener => listener(progress));
};

export const subscribeToMigration = (listener: (value: MigrationProgress) => void) => {
  listeners.add(listener);
  listener(progress);
  return () => {
    listeners.delete(listener);
  };
};

export const getMigrationProgress = () => progress;

/**
 * Convert one entry. Returns the new reference arrays, or null when there was
 * nothing to do.
 *
 * Only one image's base64 is reachable at a time: the loop reads element `i`,
 * hands it to the store (which writes it to disk and drops it), then moves on.
 */
const migrateEntry = async (entryId: string): Promise<{ refs: string[]; failures: number }> => {
  const raw = await database.getRawEntryImages(entryId);
  if (!raw) return { refs: [], failures: 0 };

  // Prefer the full-size column; fall back to thumbnails if that is all there is.
  const source = raw.images.length > 0 ? raw.images : raw.thumbnails;
  const refs: string[] = [];
  let failures = 0;

  for (let index = 0; index < source.length; index++) {
    const value = source[index];

    // Already converted, or a sentinel from the old thumbnail migration.
    if (isFileRef(value)) {
      refs.push(value);
      continue;
    }
    if (value === FAILED_SENTINEL || !isInlineBase64(value)) {
      failures += 1;
      continue;
    }

    try {
      const stored = await imageStore.importFromBase64(value);
      refs.push(stored.ref);
    } catch (error) {
      console.warn(`Image migration failed for entry ${entryId} image ${index}`, error);
      failures += 1;
    }

    // Between images too: a single entry can hold dozens.
    await yieldToUi();
  }

  return { refs, failures };
};

/**
 * Run the migration to completion in the background.
 * Safe to call repeatedly — concurrent calls collapse into the running one.
 */
let running: Promise<MigrationProgress> | null = null;

export const runImageMigration = async (): Promise<MigrationProgress> => {
  if (running) return running;

  running = (async () => {
    try {
      const total = await database.countUnmigratedEntries();
      if (total === 0) {
        emit({ total: 0, completed: 0, failed: 0, running: false, finished: true });
        await finalise();
        return progress;
      }

      emit({ total, completed: 0, failed: 0, running: true, finished: false });
      console.log(`Image migration: converting ${total} entries to file-backed storage.`);

      let completed = 0;
      let failed = 0;

      // Re-query each round rather than holding a list: rows can be edited or
      // deleted while this runs, and the flag is the source of truth.
      for (;;) {
        const ids = await database.getUnmigratedEntryIds(BATCH_SIZE);
        if (ids.length === 0) break;

        for (const entryId of ids) {
          try {
            const { refs, failures } = await migrateEntry(entryId);
            // The same reference addresses both the full image and its
            // thumbnail, so both columns store the same array.
            await database.markEntryMigrated(entryId, refs, refs);
            failed += failures;
          } catch (error) {
            console.warn(`Image migration: giving up on entry ${entryId}`, error);
            // Mark it done anyway so a permanently broken row cannot wedge the
            // migration in an infinite loop.
            await database.markEntryMigrated(entryId, [], []);
            failed += 1;
          }

          completed += 1;
          emit({ completed, failed });
          await yieldToUi();
        }
      }

      emit({ running: false, finished: true });
      console.log(`Image migration complete: ${completed} entries, ${failed} images unrecoverable.`);
      await finalise();
      return progress;
    } catch (error) {
      console.error('Image migration failed', error);
      emit({ running: false });
      return progress;
    } finally {
      running = null;
    }
  })();

  return running;
};

/**
 * Post-migration housekeeping: drop orphaned blobs, then reclaim the database
 * pages the base64 used to occupy. Without the VACUUM the file stays as large
 * as it ever was, which is confusing even though memory is fixed.
 */
const finalise = async () => {
  try {
    await database.setMeta(META_KEY_VERSION, MIGRATION_VERSION);

    const liveRefs = await database.getAllImageRefs();
    const removed = await imageStore.collectGarbage(liveRefs);
    if (removed > 0) console.log(`Image store: removed ${removed} orphaned files.`);

    const alreadyCompacted = await database.getMeta(META_KEY_COMPACTED);
    if (!alreadyCompacted && Platform.OS !== 'web') {
      await database.compactDatabase();
      await database.setMeta(META_KEY_COMPACTED, '1');
      console.log('Database compacted.');
    }
  } catch (error) {
    console.warn('Post-migration housekeeping failed', error);
  }
};

/**
 * Kick the migration off once the app has settled.
 *
 * Deliberately waits for interactions to finish rather than firing on mount:
 * the first seconds after launch are when the user is most likely to be
 * scrolling, and image decoding competes for the same thread.
 */
export const scheduleImageMigration = (delayMs = 2500) => {
  const start = () => {
    setTimeout(() => {
      void runImageMigration();
    }, delayMs);
  };

  if (typeof InteractionManager?.runAfterInteractions === 'function') {
    InteractionManager.runAfterInteractions(start);
  } else {
    start();
  }
};

/** Manual "Optimize image storage" action in Settings. */
export const runImageMigrationNow = () => runImageMigration();

/** Drop blobs no entry references any more. Cheap; safe to call after deletes. */
export const collectImageGarbage = async (): Promise<number> => {
  const liveRefs = await database.getAllImageRefs();
  return imageStore.collectGarbage(liveRefs);
};
