/**
 * Image ingestion.
 *
 * Previously `processImage` returned a `data:image/jpeg;base64,...` string that
 * was stored directly in the entry row. Everything now goes through the image
 * store and callers receive a short reference instead.
 *
 * The legacy `processImage` / `generateThumbnail` names are kept as deprecated
 * wrappers so nothing that still imports them breaks, but they now return refs.
 */
import * as imageStore from './imageStore';
import { StoredImage } from './imageRef';
import { rememberDimensions } from './imageDimensions';

export type { StoredImage };

/**
 * Record the size of a freshly imported image.
 *
 * The encoder already knows it — it just finished scaling the photo — so this
 * costs nothing, and it means the entry list can size a row containing this
 * image without ever reading the file back.
 */
const recordSize = (stored: StoredImage): StoredImage => {
  if (stored.width > 0 && stored.height > 0) {
    rememberDimensions(stored.ref, { width: stored.width, height: stored.height });
  }
  return stored;
};

/**
 * Import an image from a picker/camera/clipboard URI.
 * Produces both the full-size and thumbnail variants and returns one ref that
 * addresses both.
 */
export const importImage = async (uri: string): Promise<StoredImage> =>
  recordSize(await imageStore.importFromUri(uri));

/** Import inline base64 (clipboard on some platforms, legacy CSV import). */
export const importBase64Image = async (
  base64: string,
  mime = 'image/jpeg',
): Promise<StoredImage> => recordSize(await imageStore.importFromBase64(base64, mime));

/** Resolve a stored ref to something renderable. */
export const resolveImageUri = imageStore.resolveImageUri;

/**
 * @deprecated Use `importImage`. Returns a reference, not base64.
 */
export const processImage = async (uri: string): Promise<string> => {
  const stored = await imageStore.importFromUri(uri);
  return stored.ref;
};

/**
 * @deprecated Thumbnails are generated automatically by `importImage`; the same
 * ref addresses both variants. Kept so older call sites keep compiling.
 */
export const generateThumbnail = async (uriOrRef: string): Promise<string> => {
  if (uriOrRef.startsWith('img:')) return uriOrRef;
  const stored = await imageStore.importFromUri(uriOrRef);
  return stored.ref;
};
