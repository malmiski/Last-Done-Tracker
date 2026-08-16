import { zlibSync } from 'fflate';
import { decodePng } from './pngDecode';
import { findContentBounds } from './blackBorders';

/**
 * Build a real PNG so the decoder is tested against the actual format rather
 * than a convenient stand-in. Non-interlaced, 8-bit, filter type configurable.
 */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): number[] => {
  const typeBytes = [...type].map(ch => ch.charCodeAt(0));
  const body = new Uint8Array([...typeBytes, ...data]);
  const length = data.length;
  const crc = crc32(body);
  return [
    (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...body,
    (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff,
  ];
};

const buildPng = ({
  rows,
  width,
  channels = 3,
  filter = 0,
}: {
  rows: number[][][]; // [y][x][channel]
  width: number;
  channels?: 3 | 4;
  filter?: 0 | 1 | 2;
}): Uint8Array => {
  const height = rows.length;

  // Raw scanlines: one filter byte then the pixel bytes.
  const rowBytes = width * channels;
  const raw: number[] = [];
  const previous = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(rowBytes);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) line[x * channels + c] = rows[y][x][c];
    }

    raw.push(filter);
    for (let i = 0; i < rowBytes; i++) {
      if (filter === 0) raw.push(line[i]);
      else if (filter === 1) raw.push((line[i] - (i >= channels ? line[i - channels] : 0)) & 0xff);
      else raw.push((line[i] - previous[i]) & 0xff); // Up
    }
    previous.set(line);
  }

  const ihdr = new Uint8Array([
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8, channels === 4 ? 6 : 2, 0, 0, 0,
  ]);

  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibSync(new Uint8Array(raw))),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
};

const solidRows = (colour: number[], count: number, width: number) =>
  Array.from({ length: count }, () => Array.from({ length: width }, () => colour));

describe('decodePng', () => {
  it('decodes an unfiltered RGB image', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30], 3, 2), width: 2 });
    const decoded = decodePng(png)!;

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(3);
    // Always normalised to RGBA.
    expect(Array.from(decoded.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  });

  it('decodes RGBA without altering alpha', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30, 128], 2, 2), width: 2, channels: 4 });
    const decoded = decodePng(png)!;
    expect(Array.from(decoded.data.subarray(0, 4))).toEqual([10, 20, 30, 128]);
  });

  it('reverses the Sub filter', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30], 2, 4), width: 4, filter: 1 });
    const decoded = decodePng(png)!;
    for (let x = 0; x < 4; x++) {
      expect(Array.from(decoded.data.subarray(x * 4, x * 4 + 3))).toEqual([10, 20, 30]);
    }
  });

  it('reverses the Up filter', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30], 4, 2), width: 2, filter: 2 });
    const decoded = decodePng(png)!;
    // Last row must still be the original colour, not an accumulated drift.
    const lastRow = decoded.data.subarray(3 * 2 * 4, 3 * 2 * 4 + 3);
    expect(Array.from(lastRow)).toEqual([10, 20, 30]);
  });

  it('returns null for input that is not a PNG', () => {
    expect(decodePng(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(decodePng(new Uint8Array(0))).toBeNull();
    // A JPEG.
    expect(decodePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]))).toBeNull();
  });

  it('returns null rather than guessing at unsupported variants', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30], 2, 2), width: 2 });
    // Flip the colour type byte to 3 (palette), which we do not handle.
    const palette = new Uint8Array(png);
    palette[8 + 8 + 9] = 3;
    expect(decodePng(palette)).toBeNull();

    // Flip the interlace byte.
    const interlaced = new Uint8Array(png);
    interlaced[8 + 8 + 12] = 1;
    expect(decodePng(interlaced)).toBeNull();
  });

  it('returns null for truncated data instead of throwing', () => {
    const png = buildPng({ rows: solidRows([10, 20, 30], 4, 4), width: 4 });
    expect(decodePng(png.subarray(0, 30))).toBeNull();
  });
});

describe('decode -> detect, end to end', () => {
  it('finds letterbox bars in a decoded PNG probe', () => {
    // This is the shape the native path actually produces: a narrow, full
    // height proxy rendered by the image manipulator.
    const width = 8;
    const png = buildPng({
      rows: [
        ...solidRows([0, 0, 0], 12, width),
        ...solidRows([180, 40, 60], 40, width),
        ...solidRows([0, 0, 0], 12, width),
      ],
      width,
    });

    const decoded = decodePng(png)!;
    expect(findContentBounds(decoded)).toEqual({ top: 12, bottom: 51 });
  });

  it('reports no bars on a proxy of an ordinary photo', () => {
    const width = 8;
    const png = buildPng({ rows: solidRows([180, 40, 60], 40, width), width });
    expect(findContentBounds(decodePng(png)!)).toBeNull();
  });
});
