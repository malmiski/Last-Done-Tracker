/**
 * Web image store — blobs live in a dedicated IndexedDB object store and are
 * handed to the DOM as short-lived object URLs.
 *
 * Two things make this bounded:
 *   1. Blobs are never held as base64 strings. A Blob is backed by browser
 *      storage, not the JS heap, so keeping a reference is cheap.
 *   2. Object URLs are pooled in an LRU and revoked on eviction. Without that,
 *      every createObjectURL pins its blob in memory for the life of the
 *      document, which is the web equivalent of the native leak.
 */
import { HEADER_BYTES, ImageSize, readImageSize } from './jpegSize';
import { BorderBounds, boundsHeight, findContentBounds, scaleBounds } from './blackBorders';
import {
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

const DB_NAME = 'activities_images';
const DB_VERSION = 1;
const BLOB_STORE = 'image_blobs';

export const FULL_MAX_DIMENSION = 1600;
export const FULL_QUALITY = 0.75;
export const THUMB_MAX_DIMENSION = 400;
export const THUMB_QUALITY = 0.6;

/** How many object URLs stay alive at once. Roughly a few screens' worth. */
const URL_CACHE_LIMIT = 80;

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
};

const blobKey = (id: string, variant: ImageVariant) =>
  variant === 'thumb' ? `${id}:thumb` : `${id}:full`;

const putBlob = async (id: string, variant: ImageVariant, blob: Blob): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put(blob, blobKey(id, variant));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getBlob = async (id: string, variant: ImageVariant): Promise<Blob | null> => {
  const db = await openDb();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const request = tx.objectStore(BLOB_STORE).get(blobKey(id, variant));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
};

const removeBlob = async (id: string, variant: ImageVariant): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).delete(blobKey(id, variant));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/* ------------------------------------------------------------------ *
 * Object URL LRU
 * ------------------------------------------------------------------ */

/**
 * Object URLs are reference counted.
 *
 * An earlier version revoked URLs unconditionally, which produced a subtle and
 * unrecoverable bug: revoking a URL that a mounted <img> is still pointing at
 * breaks that element permanently. It does not retry, and React will not
 * re-resolve because the ref and variant it depends on have not changed. The
 * visible symptom was switching from small to medium thumbnails — both use the
 * 'thumb' variant, so nothing re-resolved — leaving the already-rendered tiles
 * broken while ones scrolled into view afterwards loaded fine.
 *
 * The rule now: a URL is only ever revoked when nothing holds it. Components
 * retain on mount and release on unmount, so "free memory" means "free what is
 * off-screen", which is what was actually intended.
 */
interface PooledUrl {
  url: string;
  /** Number of mounted components currently displaying this URL. */
  refs: number;
}

const urlCache = new Map<string, PooledUrl>();

/**
 * Bumped whenever cached URLs are invalidated. Components observe it and
 * re-resolve, so a released-then-revoked URL cannot linger in the DOM.
 */
let cacheEpoch = 0;
const epochListeners = new Set<(epoch: number) => void>();

const bumpEpoch = () => {
  cacheEpoch += 1;
  epochListeners.forEach(listener => listener(cacheEpoch));
};

export const getCacheEpoch = (): number => cacheEpoch;

export const subscribeToCacheEpoch = (listener: (epoch: number) => void): (() => void) => {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
};

const revoke = (entry: PooledUrl) => {
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    /* already revoked */
  }
};

/** Evict idle entries, oldest first, until the pool is back within budget. */
const trimPool = () => {
  if (urlCache.size <= URL_CACHE_LIMIT) return;
  for (const [key, entry] of urlCache) {
    if (urlCache.size <= URL_CACHE_LIMIT) break;
    // Never evict something on screen — that is the bug described above.
    if (entry.refs > 0) continue;
    urlCache.delete(key);
    revoke(entry);
  }
};

const rememberUrl = (key: string, url: string): PooledUrl => {
  const existing = urlCache.get(key);
  if (existing) {
    // Re-inserting moves the key to the most-recent position in the LRU.
    urlCache.delete(key);
    urlCache.set(key, existing);
    return existing;
  }
  const entry: PooledUrl = { url, refs: 0 };
  urlCache.set(key, entry);
  trimPool();
  return entry;
};

/** Take a hold on a URL so it cannot be revoked while it is being displayed. */
export const retainUrl = (key: string): void => {
  const entry = urlCache.get(key);
  if (entry) entry.refs += 1;
};

/** Give up a hold. The URL stays pooled for reuse until it is evicted. */
export const releaseUrl = (key: string): void => {
  const entry = urlCache.get(key);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) trimPool();
};

/**
 * Release the memory held by images that are not currently on screen.
 *
 * Deliberately leaves retained URLs alone: revoking those would break visible
 * images without reclaiming anything the user is not looking at.
 */
export const clearMemoryCache = (): void => {
  let released = 0;
  for (const [key, entry] of [...urlCache]) {
    if (entry.refs > 0) continue;
    urlCache.delete(key);
    revoke(entry);
    released += 1;
  }
  if (released > 0) bumpEpoch();
};

/**
 * Drop a specific cached URL, retained or not.
 * Used when the underlying blob changes or is deleted, where continuing to
 * serve the old URL would show stale content. The epoch bump makes any mounted
 * component re-resolve rather than keep a dead reference.
 */
const invalidateKey = (key: string): void => {
  const entry = urlCache.get(key);
  if (!entry) return;
  urlCache.delete(key);
  revoke(entry);
  bumpEpoch();
};

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

const loadBitmap = async (source: Blob | string, maxDimension: number): Promise<ImageBitmap | HTMLImageElement> => {
  const blob =
    typeof source === 'string' ? await (await fetch(source)).blob() : source;

  // createImageBitmap with resize options downsamples during decode, so a 12MP
  // photo never becomes a 48MB full-resolution bitmap on the way through.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        resizeWidth: maxDimension,
        resizeQuality: 'high',
      } as ImageBitmapOptions);
    } catch {
      /* Safari lacks resize options on some versions; fall through. */
    }
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> */
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * One reusable scratch canvas for the whole app.
 *
 * WKWebView (which backs Chrome and Safari on iOS) enforces a process-wide
 * canvas backing-store budget and reclaims it lazily. Allocating a fresh canvas
 * per image is the classic way to hit "total canvas memory exceeded" and have
 * the tab killed mid-import. Reusing one canvas and zeroing it afterwards keeps
 * the high-water mark at a single image.
 */
let scratchCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

const getScratchCanvas = (width: number, height: number) => {
  if (!scratchCanvas) {
    scratchCanvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
  }
  (scratchCanvas as any).width = width;
  (scratchCanvas as any).height = height;
  return scratchCanvas;
};

const releaseScratchCanvas = () => {
  if (!scratchCanvas) return;
  // Zero-sizing frees the backing store immediately rather than at GC time.
  (scratchCanvas as any).width = 0;
  (scratchCanvas as any).height = 0;
};

const encode = async (
  source: Blob | string,
  maxDimension: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const bitmap = await loadBitmap(source, maxDimension);

  try {
    const naturalWidth = (bitmap as any).width as number;
    const naturalHeight = (bitmap as any).height as number;

    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = getScratchCanvas(width, height);
    const ctx = (canvas as any).getContext('2d');
    ctx.drawImage(bitmap as any, 0, 0, width, height);

    // Release the decoded bitmap as soon as it has been drawn.
    (bitmap as any).close?.();

    const blob: Blob =
      typeof (canvas as any).convertToBlob === 'function'
        ? await (canvas as any).convertToBlob({ type: 'image/jpeg', quality })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              'image/jpeg',
              quality,
            ),
          );

    return { blob, width, height };
  } finally {
    (bitmap as any).close?.();
    releaseScratchCanvas();
  }
};

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

/* ------------------------------------------------------------------ *
 * Public API — mirrors imageStore.ts
 * ------------------------------------------------------------------ */

/**
 * Resolve to an object URL and report the pool key alongside it, so the caller
 * can retain and release. Returns null when there is no blob for this variant.
 */
/**
 * `retain` must be set by callers that will display the result.
 *
 * It exists because taking the hold *after* this resolves is too late. There is
 * an `await` between creating the pool entry and any caller-side retain, and in
 * that gap another image resolving can run `trimPool()`, see this entry sitting
 * at zero references, evict it and revoke its URL. The caller then receives a
 * URL that is already dead and renders blank — permanently, because nothing
 * about its inputs has changed to trigger a re-resolve.
 *
 * Retaining here closes the window: the entry is never observable at zero
 * references between creation and the caller taking ownership.
 */
export const acquireUrl = async (
  id: string,
  variant: ImageVariant = 'full',
  retain = false,
): Promise<{ uri: string; key: string } | null> => {
  const key = blobKey(id, variant);

  const cached = urlCache.get(key);
  if (cached) {
    const entry = rememberUrl(key, cached.url);
    if (retain) entry.refs += 1;
    return { uri: entry.url, key };
  }

  const blob = await getBlob(id, variant);
  if (!blob) return null;

  const entry = rememberUrl(key, URL.createObjectURL(blob));
  if (retain) entry.refs += 1;
  return { uri: entry.url, key };
};

export const fileUriFor = async (
  id: string,
  variant: ImageVariant = 'full',
): Promise<string | null> => (await acquireUrl(id, variant))?.uri ?? null;

/**
 * Resolve a stored reference and take a hold on the result.
 *
 * `key` is null for values that are not pooled (inline base64), in which case
 * `releaseImageUri` is a no-op.
 */
export const acquireImageUri = async (
  ref?: string | null,
  variant: ImageVariant = 'full',
): Promise<{ uri: string; key: string | null } | null> => {
  if (!isRenderable(ref)) return null;
  const value = ref as string;

  if (isFileRef(value)) {
    const id = refId(value);
    // Retained inside acquireUrl, not after it — see the note there.
    // A missing thumbnail is not fatal: fall back to the full image.
    const resolved = (await acquireUrl(id, variant, true)) ??
      (variant === 'thumb' ? await acquireUrl(id, 'full', true) : null);
    return resolved ?? null;
  }

  if (isInlineBase64(value)) return { uri: toDataUri(value), key: null };
  return null;
};

export const releaseImageUri = (key: string | null): void => {
  if (key) releaseUrl(key);
};

export const resolveImageUri = async (
  ref?: string | null,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  if (!isRenderable(ref)) return null;
  const value = ref as string;

  if (isFileRef(value)) {
    const id = refId(value);
    const url = await fileUriFor(id, variant);
    if (!url && variant === 'thumb') return fileUriFor(id, 'full');
    return url;
  }

  if (isInlineBase64(value)) return toDataUri(value);
  return null;
};

const storeBoth = async (source: Blob | string): Promise<StoredImage> => {
  const id = newId();

  const full = await encode(source, FULL_MAX_DIMENSION, FULL_QUALITY);
  await putBlob(id, 'full', full.blob);

  // Thumbnail is derived from the already-downscaled blob.
  const thumb = await encode(full.blob, THUMB_MAX_DIMENSION, THUMB_QUALITY);
  await putBlob(id, 'thumb', thumb.blob);

  return { ref: makeFileRef(id), width: full.width, height: full.height, bytes: full.blob.size };
};

export const importFromUri = async (sourceUri: string): Promise<StoredImage> => storeBoth(sourceUri);

export const importFromBlob = async (blob: Blob): Promise<StoredImage> => storeBoth(blob);

export const importFromBase64 = async (
  value: string,
  mime = 'image/jpeg',
): Promise<StoredImage> => storeBoth(toDataUri(value, mime));

export const readAsBase64 = async (
  ref: string,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  if (isInlineBase64(ref)) return stripDataUri(ref);
  const bytes = await readAsBytes(ref, variant);
  if (!bytes) return null;

  // 8K per chunk: JavaScriptCore (which backs Chrome and Safari on iOS) throws
  // RangeError on spread calls with tens of thousands of arguments, so the
  // usual 32K chunk is not safe there.
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
};

export const readAsBytes = async (
  ref: string,
  variant: ImageVariant = 'full',
): Promise<Uint8Array | null> => {
  if (!isFileRef(ref)) return null;
  const blob = await getBlob(refId(ref), variant);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
};

export const writeFromBytes = async (
  bytes: Uint8Array,
  variant: ImageVariant,
  existingId?: string,
): Promise<string> => {
  const id = existingId ?? newId();
  // `.slice().buffer` yields a plain ArrayBuffer, which every Blob
  // implementation accepts — some TypedArray views are rejected on older
  // Safari builds.
  await putBlob(id, variant, new Blob([bytes.slice().buffer], { type: 'image/jpeg' }));

  // Importing over an existing id replaces the blob, but an object URL pins the
  // *old* Blob for its lifetime — without this, a re-import would keep showing
  // the previous image.
  invalidateKey(blobKey(id, variant));

  return makeFileRef(id);
};

/* ------------------------------------------------------------------ *
 * Dimensions
 * ------------------------------------------------------------------ */

const dimensionCache = new Map<string, ImageSize | null>();

/**
 * Natural pixel dimensions, read from the blob header without decoding.
 *
 * `blob.slice()` is lazy — it does not copy — so this reads at most 64KB off
 * storage per image. Decoding to measure would cost the full bitmap, which on
 * web is ~7.7MB for a 1600x1200 image and is exactly what we are avoiding.
 *
 * Pass 'full' when the result will drive layout: the thumbnail shares the
 * aspect ratio but is capped at 400px, so its absolute dimensions are not the
 * image's real size. Both headers cost the same bounded slice.
 */
export const getImageSize = async (
  ref: string,
  variant: ImageVariant = 'full',
): Promise<ImageSize | null> => {
  if (!isFileRef(ref)) return null;

  const cacheKey = `${ref}:${variant}`;
  const cached = dimensionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const id = refId(ref);
  const blob = (await getBlob(id, variant)) ?? (variant === 'thumb' ? await getBlob(id, 'full') : null);
  if (!blob) {
    dimensionCache.set(cacheKey, null);
    return null;
  }

  let size: ImageSize | null = null;
  try {
    const header = blob.slice(0, HEADER_BYTES);
    size = readImageSize(new Uint8Array(await header.arrayBuffer()));
  } catch {
    size = null;
  }

  dimensionCache.set(cacheKey, size);
  return size;
};

/* ------------------------------------------------------------------ *
 * Letterbox detection and cropping
 * ------------------------------------------------------------------ */

/**
 * Columns sampled when inspecting pixels. Only vertical resolution matters for
 * top/bottom bars, so the image is squeezed to a few columns at full height —
 * ~50KB of pixel data instead of the ~10MB a full-size getImageData would cost
 * on the same picture.
 */
const PROBE_WIDTH = 8;

export const detectBlackBorders = async (
  ref: string,
): Promise<(BorderBounds & { height: number }) | null> => {
  if (!isFileRef(ref)) return null;

  const blob = await getBlob(refId(ref), 'full');
  if (!blob) return null;

  let bitmap: any;
  try {
    // No resize hint: squeezing happens in drawImage below, and we need the
    // true height to map bounds back.
    bitmap = await loadBitmap(blob, FULL_MAX_DIMENSION);
    const naturalHeight = bitmap.height as number;
    const naturalWidth = bitmap.width as number;
    if (!naturalHeight || !naturalWidth) return null;

    const canvas = getScratchCanvas(PROBE_WIDTH, naturalHeight);
    const ctx = (canvas as any).getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, PROBE_WIDTH, naturalHeight);

    const imageData = ctx.getImageData(0, 0, PROBE_WIDTH, naturalHeight);
    const bounds = findContentBounds({
      data: new Uint8Array(imageData.data.buffer.slice(0)),
      width: PROBE_WIDTH,
      height: naturalHeight,
    });
    if (!bounds) return null;

    return { ...scaleBounds(bounds, naturalHeight, naturalHeight), height: naturalHeight };
  } catch (error) {
    console.warn('Could not inspect image for black borders', error);
    return null;
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      /* best effort */
    }
    releaseScratchCanvas();
  }
};

export const cropStoredImage = async (
  ref: string,
  bounds: BorderBounds,
): Promise<StoredImage | null> => {
  if (!isFileRef(ref)) return null;

  const blob = await getBlob(refId(ref), 'full');
  if (!blob) return null;

  let bitmap: any;
  try {
    bitmap = await loadBitmap(blob, FULL_MAX_DIMENSION);
    const sourceWidth = bitmap.width as number;
    const sourceHeight = bitmap.height as number;

    const height = boundsHeight(bounds);
    if (height <= 0 || bounds.top < 0 || bounds.top + height > sourceHeight) return null;

    const canvas = getScratchCanvas(sourceWidth, height);
    const ctx = (canvas as any).getContext('2d');
    // Source rect skips the bars; destination is the full canvas.
    ctx.drawImage(bitmap, 0, bounds.top, sourceWidth, height, 0, 0, sourceWidth, height);

    const cropped: Blob =
      typeof (canvas as any).convertToBlob === 'function'
        ? await (canvas as any).convertToBlob({ type: 'image/jpeg', quality: FULL_QUALITY })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              b => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              'image/jpeg',
              FULL_QUALITY,
            ),
          );

    // storeBoth re-encodes and derives a matching thumbnail.
    return await storeBoth(cropped);
  } catch (error) {
    console.warn('Could not crop image', error);
    return null;
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      /* best effort */
    }
    releaseScratchCanvas();
  }
};

export const sizeOf = async (ref: string, variant: ImageVariant = 'full'): Promise<number> => {
  if (!isFileRef(ref)) return 0;
  const blob = await getBlob(refId(ref), variant);
  return blob?.size ?? 0;
};

export const deleteRef = async (ref: string): Promise<void> => {
  if (!isFileRef(ref)) return;
  const id = refId(ref);
  for (const variant of ['full', 'thumb'] as ImageVariant[]) {
    invalidateKey(blobKey(id, variant));
    await removeBlob(id, variant);
  }
};

export const collectGarbage = async (liveRefs: Set<string>): Promise<number> => {
  const db = await openDb();
  const liveIds = new Set<string>();
  liveRefs.forEach((ref) => {
    if (isFileRef(ref)) liveIds.add(refId(ref));
  });

  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const request = tx.objectStore(BLOB_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const stale = keys.filter((key) => {
    const id = String(key).split(':')[0];
    return !liveIds.has(id);
  });
  if (stale.length === 0) return 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    const store = tx.objectStore(BLOB_STORE);
    stale.forEach((key) => store.delete(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return stale.length;
};

export const totalBytes = async (): Promise<number> => {
  const db = await openDb();
  const blobs = await new Promise<Blob[]>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const request = tx.objectStore(BLOB_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return blobs.reduce((sum, blob) => sum + (blob?.size ?? 0), 0);
};
