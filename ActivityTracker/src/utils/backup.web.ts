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
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import * as database from './database';
import * as imageStore from './imageStore';
import {
  CSV_FILENAME,
  CSV_HEADER,
  IMAGES_FOLDER,
  archiveNameFor,
  buildCsvRow,
  parseArchiveName,
  recordImportedId,
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
  let fileHandle: FileSystemFileHandle | null = null;
  let writable: FileSystemWritableFileStream | null = null;

  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();

      // Clean up previous drafts
      try {
        // @ts-expect-error values() iterator is not fully typed in DOM lib
        for await (const [name, handle] of root.entries()) {
          if (name.startsWith('draft-') && name.endsWith('.zip')) {
            await root.removeEntry(name);
          }
        }
      } catch (cleanupError) {
        console.warn('Failed to clean up old OPFS drafts', cleanupError);
      }

      fileHandle = await root.getFileHandle(`draft-${Date.now()}.zip`, { create: true });
      writable = await fileHandle.createWritable();
    }
  } catch (error) {
    console.warn('OPFS not available, falling back to memory chunks', error);
  }

  const chunks: Uint8Array[] = [];
  let failed: Error | null = null;
  let pendingWrite = Promise.resolve();

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
    if (chunk && chunk.length > 0) {
      if (writable) {
        pendingWrite = pendingWrite.then(() => writable!.write(chunk)).catch(e => {
          signalError(e);
          throw e;
        });
      } else {
        chunks.push(chunk);
      }
    }
    if (final) {
      if (writable) {
        pendingWrite = pendingWrite.then(() => writable!.close()).then(signalDone).catch(e => {
          signalError(e);
          throw e;
        });
      } else {
        signalDone();
      }
    }
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

    const refStartDates = new Map<string, { startDate: Date; index: number }>();

    for (const activity of activities) {
      const entries = await database.getEntries(activity.id);
      for (const entry of entries) {
        const refs = entry.images ?? entry.thumbnails ?? [];
        refs.forEach((ref, index) => {
          if (isFileRef(ref) && !refStartDates.has(ref)) {
            refStartDates.set(ref, { startDate: entry.startDate, index });
          }
        });
      }
    }

    const imageFilesToExport = new Map<
      string,
      { ref: string; variant: 'full' | 'thumb'; archiveName: string }
    >();

    let buffer = '';
    let entriesWritten = 0;

    for (const activity of activities) {
      const entries = await database.getEntries(activity.id);

      for (const entry of entries) {
        const refs = entry.images ?? entry.thumbnails ?? [];
        refs.forEach(ref => {
          if (isFileRef(ref)) {
            const meta = refStartDates.get(ref);
            for (const variant of ['full', 'thumb'] as const) {
              const name = archiveNameFor(
                ref,
                variant,
                meta?.startDate ?? entry.startDate,
                meta?.index,
              );
              if (name) {
                const key = `${ref}:${variant}`;
                if (!imageFilesToExport.has(key)) {
                  imageFilesToExport.set(key, { ref, variant, archiveName: name });
                }
              }
            }
          }
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
          refMap: refStartDates,
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
    const imageItems = [...imageFilesToExport.values()];
    let imagesWritten = 0;

    for (const item of imageItems) {
      const bytes = await imageStore.readAsBytes(item.ref, item.variant);
      if (bytes) {
        const file = new ZipPassThrough(`${IMAGES_FOLDER}/${item.archiveName}`);
        zip.add(file);
        file.push(bytes, true);
      }

      imagesWritten += 1;
      onProgress?.({ phase: 'images', completed: imagesWritten, total: imageItems.length });
      // Yield to the event loop so the tab stays responsive and the browser
      // gets a chance to reclaim the bytes just written.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (failed) throw failed;
    }

    onProgress?.({ phase: 'finalising', completed: 0, total: 1 });
    zip.end();
    await finished;

    let url: string;
    if (fileHandle) {
      const file = await fileHandle.getFile();
      url = URL.createObjectURL(file);
    } else {
      // Each chunk is its own Blob part: the constructor never needs one
      // contiguous allocation, so a large archive does not have to fit in a
      // single buffer.
      const blob = new Blob(chunks.map(chunk => chunk.slice().buffer), { type: 'application/zip' });
      // Release the chunk references now that the Blob owns the data.
      chunks.length = 0;
      url = URL.createObjectURL(blob);
    }

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

const readAsUint8Array = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** Prompt for a file with a plain <input>, which is the reliable path on web. */
const pickFile = (): Promise<File | null> =>
  new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.csv';
    input.style.display = 'none';
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(input);
    }

    const cleanup = () => {
      try {
        if (input.parentNode) input.parentNode.removeChild(input);
      } catch {
        /* best effort */
      }
    };

    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };

    input.oncancel = () => {
      cleanup();
      resolve(null);
    };

    input.click();
  });

export const importBundle = async (onProgress?: ProgressCallback): Promise<ImportResult | null> => {
  const file = await pickFile();
  if (!file) return null;

  const nameLower = file.name.toLowerCase();
  const mimeLower = (file.type || '').toLowerCase();
  const isZip = nameLower.endsWith('.zip') || mimeLower.includes('zip');

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
    unzip.register(UnzipPassThrough);

    unzip.onfile = archiveFile => {
      const name = archiveFile.name;
      const normalizedName = name.replace(/\\/g, '/');
      const lowerName = normalizedName.toLowerCase();

      if (lowerName === CSV_FILENAME || lowerName.endsWith(`/${CSV_FILENAME}`)) {
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

      const parsed = parseArchiveName(normalizedName);
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
              recordImportedId(name, parsed.id, importedIds);
              imagesImported += 1;
              onProgress?.({ phase: 'reading', completed: imagesImported, total: 0 });
            })
            .catch(writeError => console.warn(`Failed to restore image ${name}`, writeError)),
        );
      };
      archiveFile.start();
    };

    // Chunked slice reading via FileReader works with 100% reliability across all mobile & desktop browsers
    const CHUNK_SIZE = 512 * 1024;
    let offset = 0;

    if (file.size > 0) {
      while (offset < file.size) {
        const slice = file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE));
        const chunk = await readAsUint8Array(slice);
        offset += slice.size;
        const isFinal = offset >= file.size;
        unzip.push(chunk, isFinal);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } else {
      unzip.push(new Uint8Array(0), true);
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
