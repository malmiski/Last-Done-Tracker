/**
 * Native image store — blobs live on the filesystem, never in the database and
 * never as base64 strings in JS memory.
 *
 * Layout:
 *   <documentDirectory>/entry-images/<id>.jpg        full size  (max 1600px)
 *   <documentDirectory>/entry-images/<id>_thumb.jpg  thumbnail  (max 400px)
 *
 * A row stores only "img:<id>". Resolving a ref is a pure string operation —
 * no I/O, no decode — so a list of 500 entries costs a few kilobytes.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import {
  FAILED_SENTINEL,
  ImageVariant,
  StoredImage,
  isFileRef,
  isInlineBase64,
  isRenderable,
  makeFileRef,
  refId,
  stripDataUri,
  toDataUri,
} from './imageRef';

const DIR_NAME = 'entry-images';

/**
 * Full images are capped at 1600px on the long edge. The previous code used
 * 1200px but kept the result as base64; the cap matters far less than not
 * holding the bytes in JS, and 1600px keeps pinch-zoom looking sharp.
 */
export const FULL_MAX_DIMENSION = 1600;
export const FULL_COMPRESSION = 0.75;

/**
 * Thumbnails are 400px so they stay crisp for the 100pt "medium" tile on a 3x
 * screen. At ~25KB each, a hundred of them is ~2.5MB of disk and, because
 * expo-image decodes to the display size, only a few hundred KB of bitmap.
 */
export const THUMB_MAX_DIMENSION = 400;
export const THUMB_COMPRESSION = 0.6;

let dirPromise: Promise<Directory> | null = null;

const getDir = (): Promise<Directory> => {
  if (!dirPromise) {
    dirPromise = (async () => {
      const dir = new Directory(Paths.document, DIR_NAME);
      if (!dir.exists) {
        dir.create({ intermediates: true });
      }
      return dir;
    })().catch((err) => {
      dirPromise = null;
      throw err;
    });
  }
  return dirPromise;
};

const fileName = (id: string, variant: ImageVariant) =>
  variant === 'thumb' ? `${id}_thumb.jpg` : `${id}.jpg`;

const fileFor = async (id: string, variant: ImageVariant): Promise<File> => {
  const dir = await getDir();
  return new File(dir, fileName(id, variant));
};

const newId = (): string => Crypto.randomUUID().replace(/-/g, '');

/**
 * Resize + re-encode. Prefers the modern ImageManipulator context API, which
 * exposes `release()` so the native bitmap is freed immediately instead of
 * lingering until GC — important when importing many images in a row.
 */
const renderResized = async (
  uri: string,
  maxDimension: number,
  compress: number,
): Promise<{ uri: string; width: number; height: number }> => {
  const IM = ImageManipulator as any;

  if (typeof IM.manipulate === 'function') {
    let image: any;
    try {
      const context = IM.manipulate(uri);
      context.resize({ width: maxDimension });
      image = await context.renderAsync();
      const saved = await image.saveAsync({
        format: IM.SaveFormat.JPEG,
        compress,
      });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      // Free the native bitmap right away rather than waiting for the GC.
      try {
        image?.release?.();
      } catch {
        /* best effort */
      }
    }
  }

  const result = await IM.manipulateAsync(
    uri,
    [{ resize: { width: maxDimension } }],
    { compress, format: IM.SaveFormat.JPEG },
  );
  return { uri: result.uri, width: result.width, height: result.height };
};

/** Move a manipulator output file into the store under a stable name. */
const adoptInto = async (sourceUri: string, id: string, variant: ImageVariant): Promise<number> => {
  const dest = await fileFor(id, variant);
  if (dest.exists) dest.delete();

  const source = new File(sourceUri);
  try {
    source.move(dest);
  } catch {
    // Cross-volume moves can fail; fall back to a copy then clean up.
    source.copy(dest);
    try {
      source.delete();
    } catch {
      /* cache file, fine to leave */
    }
  }
  return dest.size ?? 0;
};

/** `file://` URI for a stored blob, or null when it is not on disk. */
export const fileUriFor = async (
  id: string,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  const file = await fileFor(id, variant);
  return file.exists ? file.uri : null;
};

/**
 * Turn any stored reference into something <Image> can render.
 * Managed refs resolve to a `file://` URI; legacy inline base64 passes through
 * as a data URI so nothing breaks before the migration has run.
 */
export const resolveImageUri = async (
  ref?: string | null,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  if (!isRenderable(ref)) return null;
  const value = ref as string;

  if (isFileRef(value)) {
    const id = refId(value);
    const uri = await fileUriFor(id, variant);
    // A missing thumbnail is not fatal — fall back to the full image.
    if (!uri && variant === 'thumb') return fileUriFor(id, 'full');
    return uri;
  }

  if (isInlineBase64(value)) return toDataUri(value);
  return null;
};

/** Import an image from any URI (camera roll, clipboard temp file, download). */
export const importFromUri = async (sourceUri: string): Promise<StoredImage> => {
  const id = newId();

  const full = await renderResized(sourceUri, FULL_MAX_DIMENSION, FULL_COMPRESSION);
  const bytes = await adoptInto(full.uri, id, 'full');

  // Generate the thumbnail from the already-downscaled file, not the original:
  // decoding a 12MP original a second time is what made imports spike.
  const stored = await fileFor(id, 'full');
  const thumb = await renderResized(stored.uri, THUMB_MAX_DIMENSION, THUMB_COMPRESSION);
  await adoptInto(thumb.uri, id, 'thumb');

  return { ref: makeFileRef(id), width: full.width, height: full.height, bytes };
};

/**
 * Import inline base64. The base64 is written straight to a scratch file and
 * the string is dropped before any decoding happens, so peak memory is one
 * image rather than one image plus its decoded bitmap plus its base64 form.
 */
export const importFromBase64 = async (
  value: string,
  mime = 'image/jpeg',
): Promise<StoredImage> => {
  const dir = await getDir();
  const scratch = new File(dir, `scratch-${newId()}.tmp`);
  try {
    scratch.write(stripDataUri(value), { encoding: 'base64' });
    return await importFromUri(scratch.uri);
  } finally {
    try {
      if (scratch.exists) scratch.delete();
    } catch {
      /* best effort */
    }
  }
};

/** Read a stored blob back as base64 — only for export. */
export const readAsBase64 = async (
  ref: string,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  if (isInlineBase64(ref)) return stripDataUri(ref);
  if (!isFileRef(ref)) return null;
  const file = await fileFor(refId(ref), variant);
  if (!file.exists) return null;
  return file.base64();
};

/** Read a stored blob as raw bytes — used by the streaming zip writer. */
export const readAsBytes = async (
  ref: string,
  variant: ImageVariant = 'full',
): Promise<Uint8Array | null> => {
  if (!isFileRef(ref)) return null;
  const file = await fileFor(refId(ref), variant);
  if (!file.exists) return null;
  return file.bytes();
};

/** Write raw bytes into the store under a new id — used by zip import. */
export const writeFromBytes = async (
  bytes: Uint8Array,
  variant: ImageVariant,
  existingId?: string,
): Promise<string> => {
  const id = existingId ?? newId();
  const file = await fileFor(id, variant);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return makeFileRef(id);
};

export const sizeOf = async (ref: string, variant: ImageVariant = 'full'): Promise<number> => {
  if (!isFileRef(ref)) return 0;
  const file = await fileFor(refId(ref), variant);
  return file.exists ? file.size ?? 0 : 0;
};

export const deleteRef = async (ref: string): Promise<void> => {
  if (!isFileRef(ref)) return;
  const id = refId(ref);
  for (const variant of ['full', 'thumb'] as ImageVariant[]) {
    try {
      const file = await fileFor(id, variant);
      if (file.exists) file.delete();
    } catch {
      /* best effort */
    }
  }
};

/**
 * Delete stored blobs no longer referenced by any entry. Runs after deletes and
 * on a slow cadence at startup so orphaned files cannot accumulate forever.
 */
export const collectGarbage = async (liveRefs: Set<string>): Promise<number> => {
  const dir = await getDir();
  if (!dir.exists) return 0;

  const liveIds = new Set<string>();
  liveRefs.forEach((ref) => {
    if (isFileRef(ref)) liveIds.add(refId(ref));
  });

  let removed = 0;
  for (const item of dir.list()) {
    const name = (item as any).name as string | undefined;
    if (!name) continue;

    if (name.startsWith('scratch-')) {
      try {
        (item as File).delete();
        removed += 1;
      } catch {
        /* best effort */
      }
      continue;
    }

    if (!name.endsWith('.jpg')) continue;
    const id = name.replace(/_thumb\.jpg$/, '').replace(/\.jpg$/, '');
    if (liveIds.has(id)) continue;

    try {
      (item as File).delete();
      removed += 1;
    } catch {
      /* best effort */
    }
  }
  return removed;
};

/**
 * No-op on native: there is no object-URL pool to drain because refs resolve to
 * plain `file://` paths. The decoded-bitmap cache is owned by expo-image and is
 * trimmed via `clearImageMemoryCache()` in components/AppImage.
 */
export const clearMemoryCache = (): void => {};

/** Total bytes on disk — surfaced in Settings. */
export const totalBytes = async (): Promise<number> => {
  const dir = await getDir();
  if (!dir.exists) return 0;
  let total = 0;
  for (const item of dir.list()) {
    total += (item as File).size ?? 0;
  }
  return total;
};

export { FAILED_SENTINEL };
