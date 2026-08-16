import {
  DEFAULTS,
  PixelBuffer,
  boundsHeight,
  findContentBounds,
  scaleBounds,
  trimmedRows,
} from './blackBorders';

/**
 * Build a test image as a list of row colours, so a case reads as a picture.
 * Each entry is [r, g, b] repeated across the row.
 */
const image = (rows: [number, number, number][], width = 8): PixelBuffer => {
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach(([r, g, b], y) => {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  });
  return { data, width, height };
};

const BLACK: [number, number, number] = [0, 0, 0];
const CONTENT: [number, number, number] = [120, 90, 200];

/** n rows of the same colour. */
const band = (colour: [number, number, number], count: number) =>
  Array.from({ length: count }, () => colour);

describe('findContentBounds', () => {
  it('finds the content between top and bottom bars', () => {
    // The letterbox case: 10 black, 30 content, 10 black.
    const buffer = image([...band(BLACK, 10), ...band(CONTENT, 30), ...band(BLACK, 10)]);
    expect(findContentBounds(buffer)).toEqual({ top: 10, bottom: 39 });
  });

  it('handles a bar on only one side', () => {
    expect(findContentBounds(image([...band(BLACK, 10), ...band(CONTENT, 40)]))).toEqual({
      top: 10,
      bottom: 49,
    });
    expect(findContentBounds(image([...band(CONTENT, 40), ...band(BLACK, 10)]))).toEqual({
      top: 0,
      bottom: 39,
    });
  });

  it('returns null when there are no bars', () => {
    expect(findContentBounds(image(band(CONTENT, 50)))).toBeNull();
  });

  it('returns null for an entirely black image', () => {
    // Nothing to keep — cropping would leave zero rows.
    expect(findContentBounds(image(band(BLACK, 50)))).toBeNull();
  });

  it('tolerates compression noise in the bars', () => {
    // A "black" bar out of a JPEG is not exactly zero.
    const noisyBlack: [number, number, number] = [6, 4, 9];
    const buffer = image([...band(noisyBlack, 10), ...band(CONTENT, 30), ...band(noisyBlack, 10)]);
    expect(findContentBounds(buffer)).toEqual({ top: 10, bottom: 39 });
  });

  it('does not treat merely dark content as a bar', () => {
    // Dark grey is content, not letterboxing.
    const darkGrey: [number, number, number] = [45, 45, 45];
    expect(findContentBounds(image([...band(darkGrey, 10), ...band(CONTENT, 40)]))).toBeNull();
  });

  it('keeps a row that has a few bright pixels among black ones', () => {
    // Subtitles or a logo on an otherwise black row: that row is content.
    const buffer = image([...band(BLACK, 10), ...band(CONTENT, 30), ...band(BLACK, 10)]);
    const rowWithSpeck = 4;
    for (let x = 0; x < 4; x++) {
      const i = (rowWithSpeck * buffer.width + x) * 4;
      buffer.data[i] = 255;
      buffer.data[i + 1] = 255;
      buffer.data[i + 2] = 255;
    }
    // Half the row is bright, well past the tolerance, so content starts there.
    expect(findContentBounds(buffer)!.top).toBe(rowWithSpeck);
  });

  it('ignores a trim too small to be deliberate', () => {
    // One black row out of 200 is an edge artefact, not a letterbox bar.
    const buffer = image([...band(BLACK, 1), ...band(CONTENT, 199)]);
    expect(findContentBounds(buffer)).toBeNull();
  });

  it('refuses a trim that would remove nearly everything', () => {
    // A mostly-black photo must not be reduced to a sliver.
    const buffer = image([...band(BLACK, 95), ...band(CONTENT, 5)]);
    expect(findContentBounds(buffer)).toBeNull();
  });

  it('honours overridden thresholds', () => {
    const darkGrey: [number, number, number] = [45, 45, 45];
    const buffer = image([...band(darkGrey, 10), ...band(CONTENT, 40)]);
    expect(findContentBounds(buffer, { threshold: 60 })).toEqual({ top: 10, bottom: 49 });
  });

  it('rejects a malformed buffer rather than reading past the end', () => {
    expect(findContentBounds({ data: new Uint8Array(4), width: 8, height: 50 })).toBeNull();
    expect(findContentBounds({ data: new Uint8Array(0), width: 0, height: 0 })).toBeNull();
  });

  it('exposes its defaults for callers that need to reason about them', () => {
    expect(DEFAULTS.threshold).toBeGreaterThan(0);
    expect(DEFAULTS.maxTrimFraction).toBeLessThan(1);
  });
});

describe('scaleBounds', () => {
  it('is a no-op when the probe was full height', () => {
    expect(scaleBounds({ top: 10, bottom: 39 }, 50, 50)).toEqual({ top: 10, bottom: 39 });
  });

  it('maps probe rows onto the full-size image', () => {
    // Probe was half height, so every row index doubles.
    expect(scaleBounds({ top: 10, bottom: 39 }, 50, 100)).toEqual({ top: 20, bottom: 79 });
  });

  it('rounds outward so a rounding error leaves bar, never clips content', () => {
    const scaled = scaleBounds({ top: 3, bottom: 7 }, 10, 33);
    // floor(3 * 3.3) = 9 — earlier than the exact 9.9, keeping a sliver of bar.
    expect(scaled.top).toBeLessThanOrEqual(Math.round(3 * 3.3));
    // ceil(8 * 3.3) - 1 = 26 — later than the exact 25.4, again keeping bar.
    expect(scaled.bottom).toBeGreaterThanOrEqual(Math.round(7 * 3.3));
  });

  it('never runs past the end of the image', () => {
    const scaled = scaleBounds({ top: 0, bottom: 9 }, 10, 100);
    expect(scaled.bottom).toBeLessThanOrEqual(99);
  });
});

describe('bounds helpers', () => {
  it('measures the kept region inclusively', () => {
    expect(boundsHeight({ top: 10, bottom: 39 })).toBe(30);
    expect(boundsHeight({ top: 0, bottom: 0 })).toBe(1);
  });

  it('reports how much would be removed', () => {
    expect(trimmedRows({ top: 10, bottom: 39 }, 50)).toBe(20);
    expect(trimmedRows({ top: 0, bottom: 49 }, 50)).toBe(0);
  });
});
