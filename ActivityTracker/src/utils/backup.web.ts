/**
 * Portable backup bundle (web).
 *
 * Produces the same archive as the native implementation:
 *
 *   LastDoneTracker-2026-08-16.zip
 *   ├── data.csv
 *   └── images/…
 *
 * so a backup taken on the phone restores in the browser and vice versa. The
 * only difference is `activities.db`, which does not exist on web — IndexedDB
 * has no single file to copy — so the CSV is the whole story here. That is why
 * the CSV carries every field rather than being a convenience view.
 *
 * Memory notes for iOS WKWebView, which is the tightest target:
 *  - Output chunks are collected as separate Uint8Arrays and handed to the Blob
 *    constructor at the end. A Blob built from many parts does not require one
 *    contiguous allocation, and the browser can spill it to disk.
 *  - Images are read from IndexedDB one at a time and stored (not deflated),
 *    so no compression window is allocated per image.
 *  - Import streams the file through `File.stream()` rather than calling
 *    `arrayBuffer()`, which would materialise the whole archive at once.
 */
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import * as database from './database';
import * as imageStore from './imageStore';
import {
  CSV_FILENAME,
  CSV_HEADER,
  IMAGES_FOLDER,
  archiveNameFor,
  buildCsvRow,
  parseArchiveName,
} from './csvFormat';
import { isFileRef } from './imageRef';
import { restoreFromCsv } from './backupRestore';
import { BackupProgress, ImportResult, ProgressCallback } from './backupTypes';

export type { BackupProgress, ImportResult };

const timestamp = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export const exportBundle = async (onProgress?: ProgressCallback): Promise<string | null> => {
  const chunks: Uint8Array[] = [];
  let failed: Error | null = null;

  // The Zip callback fires as output is produced; `finished` resolves when
  // fflate signals the final chunk, which is when the Blob can be assembled.
  let signalDone: () => void = () => {};
  let signalError: (error: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    signalDone = resolve;
    signalError = reject;
  });

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed = error;
      signalError(error);
      return;
    }
    if (chunk && chunk.length > 0) chunks.push(chunk);
    if (final) signalDone();
  });

  try {
    const activities = await database.getActivities();
    if (activities.length === 0) {
      alert('No data to export.');
      return null;
    }

    /* -------- data.csv -------- */
    const csv = new ZipDeflate(CSV_FILENAME, { level: 6 });
    zip.add(csv);
    csv.push(strToU8(`${CSV_HEADER}\n`), false);

    const referencedRefs = new Set<string>();
    let buffer = '';
    let entriesWritten = 0;

    for (const activity of activities) {
      const entries = await database.getEntries(activity.id);

      for (const entry of entries) {
        const refs = entry.images ?? entry.thumbnails ?? [];
        refs.forEach(ref => {
          if (isFileRef(ref)) referencedRefs.add(ref);
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

    /* -------- images/ -------- */
    const refs = [...referencedRefs];
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
      // Yield to the event loop so the tab stays responsive and the browser
      // gets a chance to reclaim the bytes just written.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (failed) throw failed;
    }

    onProgress?.({ phase: 'finalising', completed: 0, total: 1 });
    zip.end();
    await finished;

    // Each chunk is its own Blob part: the constructor never needs one
    // contiguous allocation, so a large archive does not have to fit in a
    // single buffer.
    const blob = new Blob(chunks.map(chunk => chunk.slice().buffer), { type: 'application/zip' });
    // Release the chunk references now that the Blob owns the data.
    chunks.length = 0;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LastDoneTracker-${timestamp()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    return link.download;
  } catch (error) {
    console.error('Failed to export backup', error);
    alert('Failed to export backup.');
    return null;
  }
};

/**
 * How much origin storage the app is using, and how much the browser will
 * allow. Surfaced in Settings because iOS gives web apps a far smaller quota
 * than a native app gets, and hitting it is otherwise a silent failure.
 */
export const getStorageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/** Prompt for a file with a plain <input>, which is the reliable path on web. */
const pickFile = (): Promise<File | null> =>
  new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.csv,application/zip,text/csv';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Covers the user dismissing the dialog in browsers that fire it.
    input.oncancel = () => resolve(null);
    input.click();
  });

export const importBundle = async (onProgress?: ProgressCallback): Promise<ImportResult | null> => {
  const file = await pickFile();
  if (!file) return null;

  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';

  try {
    if (!isZip) {
      const csvText = await file.text();
      return await restoreFromCsv(csvText, new Map(), onProgress);
    }

    let csvText = '';
    const csvChunks: Uint8Array[] = [];
    const importedIds = new Map<string, string>();
    const pendingWrites: Promise<void>[] = [];
    let imagesImported = 0;

    const unzip = new Unzip();
    unzip.register(UnzipInflate);

    unzip.onfile = archiveFile => {
      const name = archiveFile.name;

      if (name === CSV_FILENAME || name.endsWith(`/${CSV_FILENAME}`)) {
        archiveFile.ondata = (error, chunk, final) => {
          if (error) throw error;
          if (chunk && chunk.length) csvChunks.push(chunk);
          if (final) {
            csvText = new TextDecoder().decode(concat(csvChunks));
            csvChunks.length = 0;
          }
        };
        archiveFile.start();
        return;
      }

      const parsed = name.startsWith(`${IMAGES_FOLDER}/`) ? parseArchiveName(name) : null;
      if (!parsed) return; // activities.db and anything unrecognised.

      const parts: Uint8Array[] = [];
      archiveFile.ondata = (error, chunk, final) => {
        if (error) throw error;
        if (chunk && chunk.length) parts.push(chunk);
        if (!final) return;

        const bytes = concat(parts);
        parts.length = 0;

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

    // Stream rather than buffering the whole archive.
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      unzip.push(value, false);
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

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    merged.set(part, offset);
    offset += part.length;
  });
  return merged;
};
