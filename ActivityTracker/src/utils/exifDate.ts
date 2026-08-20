/**
 * Reading the capture date out of a photo.
 *
 * Two ways in, because the two platforms hand us different things:
 *
 *  - `exifDateFromTags` takes the already-parsed tag object that
 *    expo-image-picker returns on native when asked for `exif: true`.
 *  - `readExifDate` parses the bytes itself, which is what web needs: the web
 *    build of the picker hands back a blob URL and no metadata at all.
 *
 * Only the header is ever needed. EXIF lives in an APP1 segment near the front
 * of the file, so the caller reads the first block of bytes and nothing else —
 * we are never holding a photo in memory to find out when it was taken.
 *
 * Note on time zones: an EXIF timestamp is wall-clock time with no zone, which
 * is exactly what the entry's start and end fields are too. So it is parsed as
 * local time and the (optional, rarely present) OffsetTime tags are ignored.
 * Applying an offset would shift a photo taken at 3pm to some other hour, which
 * is not what anyone means by "when was this taken".
 */

/** ASCII, the only EXIF value type these tags use. */
const TYPE_ASCII = 2;

const TAG_DATE_TIME = 0x0132; // IFD0: last modified, the weakest signal
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003; // when the shutter fired
const TAG_DATE_TIME_DIGITIZED = 0x9004; // when it became a file

/** Preference order: the closest thing to "when the photo was taken" first. */
const DATE_TAGS = [TAG_DATE_TIME_ORIGINAL, TAG_DATE_TIME_DIGITIZED, TAG_DATE_TIME];

const u16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number =>
  littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];

const u32 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number =>
  littleEndian
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16)) +
      bytes[offset + 3] * 0x1000000
    : bytes[offset] * 0x1000000 +
      ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);

/**
 * Parse an EXIF timestamp, "YYYY:MM:DD HH:MM:SS".
 *
 * Rejects the all-zero stamp cameras write when their clock has never been
 * set, and anything before 1900, which in practice means a corrupt field
 * rather than a genuinely old photograph.
 */
export const parseExifDateString = (value?: string | null): Date | null => {
  if (typeof value !== 'string') return null;

  const match = /^(\d{4})[:\-.](\d{2})[:\-.](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1900) return null;
  // Guards against dates that rolled over, e.g. February 31st.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date;
};

/**
 * Pull a date out of a parsed tag object.
 *
 * Shapes differ by platform and picker version: iOS tends to give a flat
 * object, Android nests the EXIF sub-IFD under its own key. Both are checked
 * rather than guessing which one this build produces.
 */
export const exifDateFromTags = (exif?: Record<string, any> | null): Date | null => {
  if (!exif || typeof exif !== 'object') return null;

  const nested = [exif, exif['{Exif}'], exif.Exif, exif.exif].filter(
    (candidate): candidate is Record<string, any> =>
      !!candidate && typeof candidate === 'object',
  );

  for (const name of ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']) {
    for (const source of nested) {
      const parsed = parseExifDateString(source[name]);
      if (parsed) return parsed;
    }
  }

  return null;
};

/**
 * Locate the TIFF block inside a JPEG's APP1 segment.
 *
 * Walks the marker chain rather than searching for the "Exif" string, so a
 * file whose pixel data happens to contain those bytes cannot be misread.
 * Stops at the start of scan: everything after that is compressed image data.
 */
const findTiffBlock = (bytes: Uint8Array): Uint8Array | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // Lost the marker chain.

    const marker = bytes[offset + 1];
    // Standalone markers carry no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // Start of scan — no metadata beyond here.

    const length = u16(bytes, offset + 2, false);
    if (length < 2) return null;

    const payload = offset + 4;
    const next = offset + 2 + length;

    if (
      marker === 0xe1 &&
      payload + 6 <= bytes.length &&
      bytes[payload] === 0x45 && // E
      bytes[payload + 1] === 0x78 && // x
      bytes[payload + 2] === 0x69 && // i
      bytes[payload + 3] === 0x66 && // f
      bytes[payload + 4] === 0x00
    ) {
      // A header-only read can truncate the segment; take what is there.
      return bytes.subarray(payload + 6, Math.min(next, bytes.length));
    }

    offset = next;
  }

  return null;
};

const readAscii = (
  tiff: Uint8Array,
  entryOffset: number,
  littleEndian: boolean,
): string | null => {
  if (u16(tiff, entryOffset + 2, littleEndian) !== TYPE_ASCII) return null;

  const count = u32(tiff, entryOffset + 4, littleEndian);
  // A timestamp is 20 bytes. Anything much larger is not one of our tags.
  if (count === 0 || count > 64) return null;

  // Values of four bytes or fewer are stored inline in the entry itself.
  const valueOffset =
    count <= 4 ? entryOffset + 8 : u32(tiff, entryOffset + 8, littleEndian);
  if (valueOffset < 0 || valueOffset + count > tiff.length) return null;

  let out = '';
  for (let i = 0; i < count; i++) {
    const code = tiff[valueOffset + i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
};

/** Cap on IFD entries and on how deep sub-IFD pointers are followed. */
const MAX_IFD_ENTRIES = 512;
const MAX_IFD_DEPTH = 2;

const scanIfd = (
  tiff: Uint8Array,
  ifdOffset: number,
  littleEndian: boolean,
  found: Map<number, string>,
  depth: number,
): void => {
  if (depth > MAX_IFD_DEPTH) return;
  if (ifdOffset < 0 || ifdOffset + 2 > tiff.length) return;

  const entries = u16(tiff, ifdOffset, littleEndian);
  if (entries > MAX_IFD_ENTRIES) return; // Corrupt rather than enormous.

  for (let i = 0; i < entries; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > tiff.length) return;

    const tag = u16(tiff, entry, littleEndian);

    if (tag === TAG_EXIF_IFD_POINTER) {
      const sub = u32(tiff, entry + 8, littleEndian);
      if (sub > 0 && sub < tiff.length) scanIfd(tiff, sub, littleEndian, found, depth + 1);
      continue;
    }

    if (DATE_TAGS.includes(tag) && !found.has(tag)) {
      const value = readAscii(tiff, entry, littleEndian);
      if (value) found.set(tag, value);
    }
  }
};

/**
 * Read the capture date straight from JPEG bytes.
 *
 * Returns null for anything that is not a JPEG carrying EXIF — PNGs and
 * screenshots normally have no capture date at all, and inventing one from the
 * file's modification time would usually just record when it was downloaded.
 */
export const readExifDate = (bytes?: Uint8Array | null): Date | null => {
  if (!bytes || bytes.length < 16) return null;

  const tiff = findTiffBlock(bytes);
  if (!tiff || tiff.length < 8) return null;

  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  if (u16(tiff, 2, littleEndian) !== 0x2a) return null;

  const ifd0 = u32(tiff, 4, littleEndian);
  if (ifd0 < 8 || ifd0 >= tiff.length) return null;

  const found = new Map<number, string>();
  try {
    scanIfd(tiff, ifd0, littleEndian, found, 0);
  } catch {
    // A malformed file must not take the import down with it.
    return null;
  }

  for (const tag of DATE_TAGS) {
    const parsed = parseExifDateString(found.get(tag));
    if (parsed) return parsed;
  }
  return null;
};

export interface CaptureRange {
  start: Date;
  end: Date;
}

/**
 * Collapse a batch of capture dates into the span they cover.
 *
 * Earliest becomes the start and latest the end, which for a series of photos
 * of one activity is the closest thing to when it began and ended. A single
 * photo gives a zero-length span, and that is the honest answer.
 */
export const captureRange = (dates: (Date | null | undefined)[]): CaptureRange | null => {
  const times = dates
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .map(date => date.getTime());

  if (times.length === 0) return null;

  return {
    start: new Date(Math.min(...times)),
    end: new Date(Math.max(...times)),
  };
};
