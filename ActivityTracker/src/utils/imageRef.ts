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

/* ------------------------------------------------------------------ *
 * base64 <-> bytes
 *
 * Hand-rolled rather than using `atob`/`btoa` (not guaranteed on Hermes) or
 * `Buffer` (needs a polyfill), and rather than expo-file-system's
 * `write(content, { encoding: 'base64' })` — the TypeScript declares that
 * overload but the native module shipped in expo-file-system 19.0.17 accepts
 * only one argument and throws:
 *
 *   InvalidArgsNumberException: Received 2 arguments, but 1 was expected
 *
 * so base64 has to be decoded in JS and written as bytes.
 * ------------------------------------------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = /*#__PURE__*/ (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Decode base64 (with or without a `data:` prefix) into raw bytes. */
export const base64ToBytes = (value: string): Uint8Array => {
  const input = stripDataUri(value).replace(/[\r\n\s]/g, '');
  if (input.length === 0) return new Uint8Array(0);

  // Tolerate missing padding, which some clipboard sources omit.
  let length = input.length;
  while (length > 0 && input[length - 1] === '=') length--;

  const byteLength = Math.floor((length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  let accumulator = 0;
  let bitsCollected = 0;

  for (let i = 0; i < length; i++) {
    const sextet = BASE64_LOOKUP[input.charCodeAt(i)];
    if (sextet === 255) continue; // skip anything not in the alphabet
    accumulator = (accumulator << 6) | sextet;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes[byteIndex++] = (accumulator >> bitsCollected) & 0xff;
    }
  }

  // The computed length can overshoot by one when input was unpadded.
  return byteIndex === byteLength ? bytes : bytes.subarray(0, byteIndex);
};

/** Encode raw bytes as base64. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    result += BASE64_ALPHABET[b0 >> 2];
    result += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    result += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    result += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return result;
};

/** Serialise refs back to the persisted column representation. */
export const serialiseRefArray = (refs?: string[] | null): string | null => {
  if (!refs || refs.length === 0) return null;
  return JSON.stringify(refs);
};
