import { fitToWidth, readImageSize, readJpegSize, readPngSize } from './jpegSize';

/**
 * These replace `Image.getSize()`, which decoded every image just to measure
 * it. If the parser silently returns null the gallery falls back to a default
 * height rather than breaking — which means a bug here is invisible in the UI,
 * so the parser is worth testing directly.
 */

/** Build a minimal but structurally valid JPEG header. */
const buildJpeg = ({
  width,
  height,
  marker = 0xc0,
  precedingSegments = [] as { marker: number; payloadLength: number }[],
}: {
  width: number;
  height: number;
  marker?: number;
  precedingSegments?: { marker: number; payloadLength: number }[];
}): Uint8Array => {
  const bytes: number[] = [0xff, 0xd8]; // SOI

  for (const segment of precedingSegments) {
    const length = segment.payloadLength + 2;
    bytes.push(0xff, segment.marker, (length >> 8) & 0xff, length & 0xff);
    for (let i = 0; i < segment.payloadLength; i++) bytes.push(0x00);
  }

  // SOF: length(2) precision(1) height(2) width(2) components(1)
  bytes.push(0xff, marker, 0x00, 0x11, 0x08);
  bytes.push((height >> 8) & 0xff, height & 0xff);
  bytes.push((width >> 8) & 0xff, width & 0xff);
  bytes.push(0x03);
  for (let i = 0; i < 9; i++) bytes.push(0x00);

  return new Uint8Array(bytes);
};

describe('readJpegSize', () => {
  it('reads dimensions from a baseline JPEG', () => {
    expect(readJpegSize(buildJpeg({ width: 1600, height: 1200 }))).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it('reads dimensions from a progressive JPEG (SOF2)', () => {
    expect(readJpegSize(buildJpeg({ width: 800, height: 600, marker: 0xc2 }))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('skips over EXIF and ICC segments to find the frame header', () => {
    // A real photo has APP1 (EXIF) and often APP2 (ICC) before the SOF.
    const bytes = buildJpeg({
      width: 4032,
      height: 3024,
      precedingSegments: [
        { marker: 0xe0, payloadLength: 14 }, // APP0/JFIF
        { marker: 0xe1, payloadLength: 2000 }, // APP1/EXIF
        { marker: 0xe2, payloadLength: 500 }, // APP2/ICC
        { marker: 0xdb, payloadLength: 65 }, // DQT
      ],
    });
    expect(readJpegSize(bytes)).toEqual({ width: 4032, height: 3024 });
  });

  it('does not mistake DHT for a frame header', () => {
    // 0xC4 sits inside the SOF marker range but is a Huffman table.
    const bytes = buildJpeg({
      width: 640,
      height: 480,
      precedingSegments: [{ marker: 0xc4, payloadLength: 30 }],
    });
    expect(readJpegSize(bytes)).toEqual({ width: 640, height: 480 });
  });

  it('handles portrait orientation', () => {
    expect(readJpegSize(buildJpeg({ width: 1200, height: 1600 }))).toEqual({
      width: 1200,
      height: 1600,
    });
  });

  it('returns null rather than throwing on non-JPEG or truncated input', () => {
    expect(readJpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(readJpegSize(new Uint8Array([]))).toBeNull();
    expect(readJpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // SOI followed immediately by EOI: valid structure, no frame.
    expect(readJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('returns null when the header is cut off mid-segment', () => {
    const full = buildJpeg({ width: 1000, height: 800 });
    expect(readJpegSize(full.subarray(0, 6))).toBeNull();
  });
});

describe('readPngSize', () => {
  it('reads dimensions from an IHDR chunk', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0, 0, 0x03, 0x20], 16); // 800
    bytes.set([0, 0, 0x02, 0x58], 20); // 600
    expect(readPngSize(bytes)).toEqual({ width: 800, height: 600 });
  });

  it('ignores non-PNG input', () => {
    expect(readPngSize(buildJpeg({ width: 100, height: 100 }))).toBeNull();
  });

  it('is reachable through readImageSize, so pasted PNGs still measure', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0x01, 0x00], 16);
    png.set([0, 0, 0x01, 0x00], 20);
    expect(readImageSize(png)).toEqual({ width: 256, height: 256 });
    expect(readImageSize(buildJpeg({ width: 10, height: 20 }))).toEqual({ width: 10, height: 20 });
  });
});

describe('fitToWidth', () => {
  it('scales a wide image down to the container width', () => {
    expect(fitToWidth({ width: 1600, height: 1200 }, 400)).toEqual({ width: 400, height: 300 });
  });

  it('never scales a small image up', () => {
    // The original gallery only ever scaled down; a 100px image stays 100px.
    expect(fitToWidth({ width: 100, height: 80 }, 400)).toEqual({ width: 100, height: 80 });
  });

  it('preserves aspect ratio for portrait images', () => {
    const fitted = fitToWidth({ width: 1200, height: 1600 }, 300);
    expect(fitted.width).toBe(300);
    expect(fitted.height).toBe(400);
  });

  it('is a no-op when the container has not been measured yet', () => {
    expect(fitToWidth({ width: 800, height: 600 }, 0)).toEqual({ width: 800, height: 600 });
  });
});
