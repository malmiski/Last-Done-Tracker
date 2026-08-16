/**
 * Portable backup bundle (native).
 *
 *   LastDoneTracker-2026-08-16.zip
 *   ├── data.csv        same columns as before; Image/Thumbnail hold filenames
 *   ├── activities.db   full-fidelity SQLite copy
 *   └── images/
 *       ├── a3f9c1.jpg
 *       └── a3f9c1_thumb.jpg
 *
 * The reason this is a zip rather than a folder: a single file is something you
 * can AirDrop, email, or drop in Drive without losing half of it.
 *
 * The reason it streams: building the archive in memory would reintroduce the
 * exact failure this branch removes. fflate's `Zip` emits output chunks as they
 * are produced, and each is appended to the output file immediately, so peak
 * memory is roughly one image regardless of library size. Images are added with
 * `ZipPassThrough` (stored, not deflated) because JPEG is already compressed —
 * deflating it costs CPU and a compression window for ~1% saving.
 *
 * Images are named by their store id, so an imported file can be written back
 * under the same id and every `img:<id>` in the CSV resolves with no remapping.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import * as database from './database';
import * as imageStore from './imageStore';
import {
  CSV_FILENAME,
  CSV_HEADER,
  DB_FILENAME,
  IMAGES_FOLDER,
  archiveNameFor,
  buildCsvRow,
  parseArchiveName,
} from './csvFormat';
import { isFileRef } from './imageRef';
import { restoreFromCsv } from './backupRestore';
import { BackupProgress, ImportResult, ProgressCallback } from './backupTypes';

export type { BackupProgress, ImportResult };

/** Bytes read per chunk when streaming a file into the unzipper. */
const READ_CHUNK = 512 * 1024;

const timestamp = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export const exportBundle = async (onProgress?: ProgressCallback): Promise<string | null> => {
  const output = new File(Paths.cache, `LastDoneTracker-${timestamp()}.zip`);
  if (output.exists) output.delete();
  output.create();

  const handle = output.open();
  let failed: Error | null = null;

  // Every chunk fflate produces is appended straight to disk.
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed = error;
      return;
    }
    if (chunk && chunk.length > 0) handle.writeBytes(chunk);
    if (final) handle.close();
  });

  try {
    const activities = await database.getActivities();
    if (activities.length === 0) {
      handle.close();
      output.delete();
      alert('No data to export.');
      return null;
    }

    /* -------- data.csv (deflated: text compresses well) -------- */
    const csv = new ZipDeflate(CSV_FILENAME, { level: 6 });
    zip.add(csv);
    csv.push(strToU8(`${CSV_HEADER}\n`), false);

    // Collected while walking the CSV so images are written exactly once even
    // when several entries share one.
    const referencedIds = new Set<string>();

    let buffer = '';
    let entriesWritten = 0;

    for (const activity of activities) {
      const entries = await database.getEntries(activity.id);

      for (const entry of entries) {
        const refs = entry.images ?? entry.thumbnails ?? [];
        refs.forEach(ref => {
          if (isFileRef(ref)) referencedIds.add(ref);
        });

        buffer += `${buildCsvRow({
          activityId: activity.id,
          activityName: activity.name,
          icon: activity.icon,
          entryId: entry.id,
          startDate: entry.startDate,
          endDate: entry.endDate,
          notes: entry.notes,
          imageRefs: refs,
          tags: entry.tags,
        })}\n`;

        entriesWritten += 1;

        // Flush every ~64KB rather than accumulating the whole file.
        if (buffer.length >= 65536) {
          csv.push(strToU8(buffer), false);
          buffer = '';
        }
        if (entriesWritten % 100 === 0) {
          onProgress?.({ phase: 'entries', completed: entriesWritten, total: 0 });
        }
      }
    }

    csv.push(strToU8(buffer), true);

    /* -------- images/ (stored: JPEG is already compressed) -------- */
    const refs = [...referencedIds];
    let imagesWritten = 0;

    for (const ref of refs) {
      for (const variant of ['full', 'thumb'] as const) {
        const name = archiveNameFor(ref, variant);
        if (!name) continue;

        const bytes = await imageStore.readAsBytes(ref, variant);
        if (!bytes) continue;

        const file = new ZipPassThrough(`${IMAGES_FOLDER}/${name}`);
        zip.add(file);
        file.push(bytes, true);
      }

      imagesWritten += 1;
      onProgress?.({ phase: 'images', completed: imagesWritten, total: refs.length });
      // Yield so the export does not block the UI thread for long stretches.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (failed) throw failed;
    }

    /* -------- activities.db -------- */
    const databaseFile = database.getDatabaseFile();
    if (databaseFile.exists) {
      onProgress?.({ phase: 'database', completed: 0, total: 1 });
      const dbEntry = new ZipDeflate(DB_FILENAME, { level: 6 });
      zip.add(dbEntry);

      // Read in chunks: the database can be large, especially pre-migration.
      const dbHandle = databaseFile.open();
      try {
        const size = databaseFile.size ?? 0;
        let read = 0;
        while (read < size) {
          const chunk = dbHandle.readBytes(Math.min(READ_CHUNK, size - read));
          if (!chunk || chunk.length === 0) break;
          read += chunk.length;
          dbEntry.push(chunk, read >= size);
        }
        if (read === 0) dbEntry.push(new Uint8Array(0), true);
      } finally {
        dbHandle.close();
      }
    }

    onProgress?.({ phase: 'finalising', completed: 0, total: 1 });
    zip.end();
    if (failed) throw failed;

    await Sharing.shareAsync(output.uri, {
      mimeType: 'application/zip',
      dialogTitle: 'Export LastDoneTracker backup',
    });
    return output.uri;
  } catch (error) {
    try {
      handle.close();
    } catch {
      /* already closed */
    }
    console.error('Failed to export backup', error);
    alert('Failed to export backup.');
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/**
 * Restore from a bundle produced by `exportBundle`, or from a bare CSV.
 *
 * Accepts three shapes so nothing previously exported becomes unreadable:
 *   1. the .zip bundle
 *   2. a CSV whose Image column holds archive filenames (images reported missing)
 *   3. a legacy CSV with inline base64, which is decoded into the image store
 */
export const importBundle = async (onProgress?: ProgressCallback): Promise<ImportResult | null> => {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (picked.canceled) return null;

  const asset = picked.assets[0];
  const file = new File(asset.uri);
  const isZip =
    asset.name?.toLowerCase().endsWith('.zip') || asset.mimeType === 'application/zip';

  try {
    if (!isZip) {
      const csvText = await file.text();
      return await restoreFromCsv(csvText, new Map(), onProgress);
    }

    /* -------- stream the archive -------- */
    let csvText = '';
    const csvChunks: Uint8Array[] = [];
    // Archive filename -> id, so CSV refs resolve after import.
    const importedIds = new Map<string, string>();
    let imagesImported = 0;

    const pendingWrites: Promise<void>[] = [];

    const unzip = new Unzip();
    unzip.register(UnzipInflate);

    unzip.onfile = archiveFile => {
      const name = archiveFile.name;

      if (name === CSV_FILENAME || name.endsWith(`/${CSV_FILENAME}`)) {
        archiveFile.ondata = (error, chunk, final) => {
          if (error) throw error;
          if (chunk && chunk.length) csvChunks.push(chunk);
          if (final) {
            const total = csvChunks.reduce((sum, part) => sum + part.length, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            csvChunks.forEach(part => {
              merged.set(part, offset);
              offset += part.length;
            });
            csvChunks.length = 0;
            csvText = new TextDecoder().decode(merged);
          }
        };
        archiveFile.start();
        return;
      }

      const parsed = name.startsWith(`${IMAGES_FOLDER}/`) ? parseArchiveName(name) : null;
      if (!parsed) {
        // activities.db and anything unrecognised are skipped: the CSV is the
        // authoritative restore path, and overwriting the live database
        // mid-session would be far more destructive than additive import.
        return;
      }

      const parts: Uint8Array[] = [];
      archiveFile.ondata = (error, chunk, final) => {
        if (error) throw error;
        if (chunk && chunk.length) parts.push(chunk);
        if (!final) return;

        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        parts.forEach(part => {
          bytes.set(part, offset);
          offset += part.length;
        });
        parts.length = 0;

        // Written under the *same* id it was exported with, so `img:<id>` in
        // the CSV resolves with no remapping table.
        pendingWrites.push(
          imageStore
            .writeFromBytes(bytes, parsed.variant, parsed.id)
            .then(() => {
              importedIds.set(parsed.id, parsed.id);
              imagesImported += 1;
              onProgress?.({ phase: 'reading', completed: imagesImported, total: 0 });
            })
            .catch(writeError => console.warn(`Failed to restore image ${name}`, writeError)),
        );
      };
      archiveFile.start();
    };

    const handle = file.open();
    try {
      const size = file.size ?? 0;
      let read = 0;
      while (read < size) {
        const chunk = handle.readBytes(Math.min(READ_CHUNK, size - read));
        if (!chunk || chunk.length === 0) break;
        read += chunk.length;
        unzip.push(chunk, read >= size);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } finally {
      handle.close();
    }

    await Promise.all(pendingWrites);

    if (!csvText) {
      alert('That archive does not contain a data.csv.');
      return null;
    }

    const result = await restoreFromCsv(csvText, importedIds, onProgress);
    return { ...result, imagesImported };
  } catch (error) {
    console.error('Failed to import backup', error);
    alert('Failed to import backup.');
    return null;
  }
};

/**
 * Disk used by the image store. Surfaced in Settings so the space cost of
 * photos is visible rather than something you discover in iOS Settings.
 * (Web reports origin quota instead; see backup.web.ts.)
 */
export const getStorageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  const usage = await imageStore.totalBytes();
  const quota = Paths.availableDiskSpace ?? 0;
  return { usage, quota };
};
