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

const urlCache = new Map<string, string>();

const rememberUrl = (key: string, url: string): string => {
  // Re-inserting moves the key to the most-recent position.
  if (urlCache.has(key)) urlCache.delete(key);
  urlCache.set(key, url);

  while (urlCache.size > URL_CACHE_LIMIT) {
    const oldestKey = urlCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldestUrl = urlCache.get(oldestKey)!;
    urlCache.delete(oldestKey);
    try {
      URL.revokeObjectURL(oldestUrl);
    } catch {
      /* already revoked */
    }
  }
  return url;
};

/** Drop every cached object URL. Called when navigating away from a gallery. */
export const clearMemoryCache = (): void => {
  urlCache.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  });
  urlCache.clear();
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

export const fileUriFor = async (
  id: string,
  variant: ImageVariant = 'full',
): Promise<string | null> => {
  const key = blobKey(id, variant);
  const cached = urlCache.get(key);
  if (cached) return rememberUrl(key, cached);

  const blob = await getBlob(id, variant);
  if (!blob) return null;
  return rememberUrl(key, URL.createObjectURL(blob));
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
  return makeFileRef(id);
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
    const key = blobKey(id, variant);
    const url = urlCache.get(key);
    if (url) {
      urlCache.delete(key);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    }
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
