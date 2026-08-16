/**
 * Image reference helpers shared by native and web.
 *
 * Historically every image was persisted as a full `data:image/jpeg;base64,...`
 * string inside the entry row. Those strings are hundreds of kilobytes each, so
 * merely *reading* a list of entries pulled tens of megabytes of JS strings into
 * memory, and handing them to <Image> forced a full-resolution native decode per
 * image. That is what produced the multi-gigabyte spikes.
 *
 * Images are now content-addressed blobs kept outside the row. The row only
 * stores a short reference:
 *
 *   "img:9f2c1a..."   -> managed blob in the image store (~14 bytes)
 *   "data:image/..."  -> LEGACY inline base64, still readable until migrated
 *   "<raw base64>"    -> LEGACY inline base64 without a data: prefix
 *   "failed"          -> sentinel written by the old thumbnail migration
 *   "legacy:<entryId>"-> placeholder emitted by list queries when the stored
 *                        value was too large to safely load into memory
 *
 * Every consumer goes through `resolveImageUri` so all four shapes keep working
 * during and after the migration.
 */

export const FILE_REF_PREFIX = 'img:';
export const LEGACY_PLACEHOLDER_PREFIX = 'legacy:';
export const FAILED_SENTINEL = 'failed';

/** Anything longer than this is assumed to be inline base64, not a reference. */
export const MAX_REF_LENGTH = 256;

export type ImageVariant = 'full' | 'thumb';

export interface StoredImage {
  ref: string;
  width: number;
  height: number;
  bytes: number;
}

export const isFileRef = (ref?: string | null): boolean =>
  typeof ref === 'string' && ref.startsWith(FILE_REF_PREFIX);

export const isLegacyPlaceholder = (ref?: string | null): boolean =>
  typeof ref === 'string' && ref.startsWith(LEGACY_PLACEHOLDER_PREFIX);

export const isFailed = (ref?: string | null): boolean => ref === FAILED_SENTINEL;

/** True when the value is inline base64 image data rather than a reference. */
export const isInlineBase64 = (ref?: string | null): boolean => {
  if (typeof ref !== 'string' || ref.length === 0) return false;
  if (isFileRef(ref) || isLegacyPlaceholder(ref) || isFailed(ref)) return false;
  return ref.startsWith('data:image') || ref.length > MAX_REF_LENGTH;
};

/** True when the value can be rendered right now (as opposed to a placeholder). */
export const isRenderable = (ref?: string | null): boolean => {
  if (typeof ref !== 'string' || ref.length === 0) return false;
  if (isFailed(ref) || isLegacyPlaceholder(ref)) return false;
  return true;
};

export const refId = (ref: string): string => ref.slice(FILE_REF_PREFIX.length);

export const makeFileRef = (id: string): string => `${FILE_REF_PREFIX}${id}`;

export const makeLegacyPlaceholder = (entryId: string): string =>
  `${LEGACY_PLACEHOLDER_PREFIX}${entryId}`;

/** Normalise inline base64 into a usable data URI. */
export const toDataUri = (value: string, mime = 'image/jpeg'): string =>
  value.startsWith('data:') ? value : `data:${mime};base64,${value}`;

/** Strip the `data:...;base64,` prefix, returning raw base64. */
export const stripDataUri = (value: string): string => {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
};

/**
 * Rough decoded-bitmap cost in bytes for an image at the given pixel size.
 * Used to size the in-memory cache budget. 4 bytes per pixel (RGBA).
 */
export const decodedBytes = (width: number, height: number): number => width * height * 4;

/** Parse a persisted column value into an array of refs. */
export const parseRefArray = (value: unknown): string[] | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string') return undefined;
  // A bare reference or a legacy inline blob is a single-element array.
  if (!value.startsWith('[')) return [value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [value];
  } catch {
    return [value];
  }
};

/** Serialise refs back to the persisted column representation. */
export const serialiseRefArray = (refs?: string[] | null): string | null => {
  if (!refs || refs.length === 0) return null;
  return JSON.stringify(refs);
};
