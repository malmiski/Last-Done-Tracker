import { captureRange, exifDateFromTags, parseExifDateString, readExifDate } from './exifDate';

/**
 * Build a real EXIF-carrying JPEG rather than a convenient stand-in, so the
 * parser is tested against the layout it will actually meet: offsets relative
 * to the TIFF header, values stored out of line, and a sub-IFD pointer.
 */
const asciiBytes = (value: string): number[] => [...value].map(c => c.charCodeAt(0)).concat(0);

const buildTiff = ({
  original,
  digitized,
  modified,
  littleEndian = true,
}: {
  original?: string;
  digitized?: string;
  modified?: string;
  littleEndian?: boolean;
}): number[] => {
  const ifd0 = modified ? [{ tag: 0x0132, value: modified }] : [];
  const exif = [
    ...(original ? [{ tag: 0x9003, value: original }] : []),
    ...(digitized ? [{ tag: 0x9004, value: digitized }] : []),
  ];
  const hasExifIfd = exif.length > 0;

  const ifd0Count = ifd0.length + (hasExifIfd ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const exifIfdSize = hasExifIfd ? 2 + exif.length * 12 + 4 : 0;

  // Strings live after both directories.
  let cursor = exifIfdOffset + exifIfdSize;
  const data: number[] = [];
  const place = (value: string) => {
    const bytes = asciiBytes(value);
    const offset = cursor;
    data.push(...bytes);
    cursor += bytes.length;
    return { offset, count: bytes.length };
  };

  const ifd0Placed = ifd0.map(entry => ({ ...entry, ...place(entry.value) }));
  const exifPlaced = exif.map(entry => ({ ...entry, ...place(entry.value) }));

  const out: number[] = [];
  const put16 = (n: number) =>
    out.push(...(littleEndian ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]));
  const put32 = (n: number) => {
    const bytes = [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    out.push(...(littleEndian ? bytes : bytes.reverse()));
  };

  // TIFF header.
  out.push(littleEndian ? 0x49 : 0x4d, littleEndian ? 0x49 : 0x4d);
  put16(0x2a);
  put32(8);

  const putEntry = (tag: number, count: number, offset: number) => {
    put16(tag);
    put16(2); // ASCII
    put32(count);
    put32(offset);
  };

  put16(ifd0Count);
  ifd0Placed.forEach(entry => putEntry(entry.tag, entry.count, entry.offset));
  if (hasExifIfd) {
    put16(0x8769);
    put16(4); // LONG
    put32(1);
    put32(exifIfdOffset);
  }
  put32(0); // No next IFD.

  if (hasExifIfd) {
    put16(exif.length);
    exifPlaced.forEach(entry => putEntry(entry.tag, entry.count, entry.offset));
    put32(0);
  }

  out.push(...data);
  return out;
};

const buildJpeg = (
  tiff: number[] | null,
  { withJfif = true }: { withJfif?: boolean } = {},
): Uint8Array => {
  const out: number[] = [0xff, 0xd8];

  // A JFIF segment ahead of the EXIF one, because real files have several
  // segments and the parser has to walk past them rather than search.
  if (withJfif) {
    const jfif = [...asciiBytes('JFIF'), 1, 2, 0, 0, 1, 0, 1, 0, 0];
    out.push(0xff, 0xe0, ((jfif.length + 2) >> 8) & 0xff, (jfif.length + 2) & 0xff, ...jfif);
  }

  if (tiff) {
    const payload = [...asciiBytes('Exif').slice(0, 4), 0x00, 0x00, ...tiff];
    out.push(0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload);
  }

  // Start of scan, then a little "image data".
  out.push(0xff, 0xda, 0x00, 0x08, 0, 1, 0, 0, 0, 0, 0x12, 0x34);
  return new Uint8Array(out);
};

describe('parseExifDateString', () => {
  it('parses the standard EXIF format as local time', () => {
    const parsed = parseExifDateString('2026:07:26 17:30:19')!;
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(26);
    expect(parsed.getHours()).toBe(17);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.getSeconds()).toBe(19);
  });

  it('rejects the unset-clock stamp cameras write', () => {
    expect(parseExifDateString('0000:00:00 00:00:00')).toBeNull();
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    // Date() would happily turn this into March 3rd.
    expect(parseExifDateString('2026:02:31 10:00:00')).toBeNull();
  });

  it('rejects nonsense without throwing', () => {
    expect(parseExifDateString(undefined)).toBeNull();
    expect(parseExifDateString('')).toBeNull();
    expect(parseExifDateString('yesterday')).toBeNull();
    expect(parseExifDateString('2026:07:26')).toBeNull();
    expect(parseExifDateString('2026:07:26 99:00:00')).toBeNull();
  });
});

describe('readExifDate', () => {
  it('reads DateTimeOriginal from a little-endian file', () => {
    const jpeg = buildJpeg(buildTiff({ original: '2026:07:26 17:30:19' }));
    expect(readExifDate(jpeg)).toEqual(new Date(2026, 6, 26, 17, 30, 19));
  });

  it('reads DateTimeOriginal from a big-endian file', () => {
    const jpeg = buildJpeg(buildTiff({ original: '2026:07:26 17:30:19', littleEndian: false }));
    expect(readExifDate(jpeg)).toEqual(new Date(2026, 6, 26, 17, 30, 19));
  });

  it('prefers when the shutter fired over when the file was written', () => {
    const jpeg = buildJpeg(
      buildTiff({
        original: '2026:07:26 17:30:19',
        digitized: '2026:07:27 09:00:00',
        modified: '2026:08:01 12:00:00',
      }),
    );
    expect(readExifDate(jpeg)).toEqual(new Date(2026, 6, 26, 17, 30, 19));
  });

  it('falls back through digitized to modified', () => {
    expect(readExifDate(buildJpeg(buildTiff({ digitized: '2026:07:27 09:00:00' })))).toEqual(
      new Date(2026, 6, 27, 9, 0, 0),
    );
    expect(readExifDate(buildJpeg(buildTiff({ modified: '2026:08:01 12:00:00' })))).toEqual(
      new Date(2026, 7, 1, 12, 0, 0),
    );
  });

  it('returns null for a JPEG with no EXIF, which is most screenshots', () => {
    expect(readExifDate(buildJpeg(null))).toBeNull();
  });

  it('returns null for formats that are not JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);
    expect(readExifDate(png)).toBeNull();
    expect(readExifDate(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readExifDate(null)).toBeNull();
  });

  it('does not mistake pixel data that spells Exif for a real segment', () => {
    // The marker walk stops at start-of-scan, so this is never even examined.
    const jpeg = buildJpeg(null);
    const withDecoy = new Uint8Array([...jpeg, ...asciiBytes('Exif'), 0, 0, ...buildTiff({ original: '1999:01:01 00:00:00' })]);
    expect(readExifDate(withDecoy)).toBeNull();
  });

  it('survives a truncated header read instead of throwing', () => {
    const jpeg = buildJpeg(buildTiff({ original: '2026:07:26 17:30:19' }));
    for (const cut of [12, 20, 32, 48]) {
      expect(() => readExifDate(jpeg.subarray(0, cut))).not.toThrow();
    }
  });

  it('survives a corrupt IFD offset', () => {
    const jpeg = buildJpeg(buildTiff({ original: '2026:07:26 17:30:19' }));
    const corrupt = new Uint8Array(jpeg);
    // The IFD0 offset sits four bytes into the TIFF block.
    const tiffStart = corrupt.indexOf(0x45, 2) + 6; // after "Exif\0\0"
    corrupt[tiffStart + 4] = 0xff;
    corrupt[tiffStart + 5] = 0xff;
    expect(readExifDate(corrupt)).toBeNull();
  });
});

describe('exifDateFromTags', () => {
  it('reads a flat tag object', () => {
    expect(exifDateFromTags({ DateTimeOriginal: '2026:07:26 17:30:19' })).toEqual(
      new Date(2026, 6, 26, 17, 30, 19),
    );
  });

  it('reads a nested sub-IFD object', () => {
    expect(exifDateFromTags({ '{Exif}': { DateTimeOriginal: '2026:07:26 17:30:19' } })).toEqual(
      new Date(2026, 6, 26, 17, 30, 19),
    );
  });

  it('prefers the original over the others wherever they sit', () => {
    expect(
      exifDateFromTags({
        DateTime: '2026:08:01 12:00:00',
        Exif: { DateTimeOriginal: '2026:07:26 17:30:19' },
      }),
    ).toEqual(new Date(2026, 6, 26, 17, 30, 19));
  });

  it('returns null for missing or unusable tags', () => {
    expect(exifDateFromTags(null)).toBeNull();
    expect(exifDateFromTags(undefined)).toBeNull();
    expect(exifDateFromTags({})).toBeNull();
    expect(exifDateFromTags({ DateTimeOriginal: '0000:00:00 00:00:00' })).toBeNull();
    expect(exifDateFromTags({ Orientation: 1 })).toBeNull();
  });
});

describe('captureRange', () => {
  it('spans earliest to latest', () => {
    const range = captureRange([
      new Date(2026, 6, 26, 18, 0, 0),
      new Date(2026, 6, 26, 17, 0, 0),
      new Date(2026, 6, 26, 19, 30, 0),
    ])!;
    expect(range.start).toEqual(new Date(2026, 6, 26, 17, 0, 0));
    expect(range.end).toEqual(new Date(2026, 6, 26, 19, 30, 0));
  });

  it('gives a zero-length span for a single photo', () => {
    const only = new Date(2026, 6, 26, 17, 0, 0);
    expect(captureRange([only])).toEqual({ start: only, end: only });
  });

  it('ignores photos with no date and reports nothing when none have one', () => {
    const only = new Date(2026, 6, 26, 17, 0, 0);
    expect(captureRange([null, only, undefined])).toEqual({ start: only, end: only });
    expect(captureRange([])).toBeNull();
    expect(captureRange([null, undefined])).toBeNull();
    expect(captureRange([new Date('nonsense')])).toBeNull();
  });
});
