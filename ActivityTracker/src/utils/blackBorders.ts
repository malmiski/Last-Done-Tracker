/**
 * Detecting letterbox bars — the black strips above and below a screenshot
 * taken from a video.
 *
 * Only the top and bottom are trimmed. Pillarboxing (bars at the sides) is a
 * different shape of problem and cropping width would be a surprise when the
 * user asked about top and bottom.
 *
 * On tolerance: the bars are nominally #000000, but JPEG is lossy and a bar
 * that started pure black comes back with values wandering a few levels either
 * side, plus ringing near the content edge. Matching exact zero would find
 * almost nothing on a real screenshot. So "black" means every channel at or
 * below a small threshold, and a row is a bar if all but a tiny fraction of
 * its pixels are black — which absorbs compression noise without swallowing a
 * row that has real content in it.
 */

export interface PixelBuffer {
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BorderBounds {
  /** First row (inclusive) that contains content. */
  top: number;
  /** Last row (inclusive) that contains content. */
  bottom: number;
}

export interface DetectOptions {
  /** Max value any channel may have and still count as black. */
  threshold?: number;
  /** Fraction of a row allowed to be non-black and still count as a bar. */
  rowTolerance?: number;
  /** Ignore results that would trim less than this fraction of the height. */
  minTrimFraction?: number;
  /** Refuse to crop away more than this fraction of the image. */
  maxTrimFraction?: number;
}

export const DEFAULTS: Required<DetectOptions> = {
  threshold: 16,
  rowTolerance: 0.02,
  // Below this the "bars" are almost certainly just a dark edge in the photo,
  // and cropping would be a change the user did not ask for.
  minTrimFraction: 0.01,
  // Above this something has gone wrong — a mostly-dark photo, say — and
  // trimming would destroy the image.
  maxTrimFraction: 0.9,
};

const isRowBlack = (
  buffer: PixelBuffer,
  row: number,
  threshold: number,
  rowTolerance: number,
): boolean => {
  const { data, width } = buffer;
  const rowStart = row * width * 4;
  const allowed = Math.floor(width * rowTolerance);
  let nonBlack = 0;

  for (let x = 0; x < width; x++) {
    const i = rowStart + x * 4;
    // Ignore alpha: a fully transparent pixel is not "content" either way, and
    // our sources are opaque.
    if (data[i] > threshold || data[i + 1] > threshold || data[i + 2] > threshold) {
      nonBlack += 1;
      if (nonBlack > allowed) return false;
    }
  }
  return true;
};

/**
 * Find the first and last rows containing content.
 *
 * Returns null when there is nothing worth trimming: no bars, bars too thin to
 * be deliberate, an entirely black image, or a result that would remove most
 * of the picture.
 */
export const findContentBounds = (
  buffer: PixelBuffer,
  options: DetectOptions = {},
): BorderBounds | null => {
  const { threshold, rowTolerance, minTrimFraction, maxTrimFraction } = {
    ...DEFAULTS,
    ...options,
  };

  const { height, width } = buffer;
  if (height <= 0 || width <= 0) return null;
  if (buffer.data.length < height * width * 4) return null;

  let top = 0;
  while (top < height && isRowBlack(buffer, top, threshold, rowTolerance)) top += 1;

  // Entirely black: there is no content to keep.
  if (top >= height) return null;

  let bottom = height - 1;
  while (bottom > top && isRowBlack(buffer, bottom, threshold, rowTolerance)) bottom -= 1;

  const trimmed = height - (bottom - top + 1);
  if (trimmed <= 0) return null;

  const trimFraction = trimmed / height;
  if (trimFraction < minTrimFraction) return null;
  if (trimFraction > maxTrimFraction) return null;

  return { top, bottom };
};

/**
 * Map bounds found in a scaled-down probe back onto the full-size image.
 *
 * Detection runs on a narrow proxy to keep memory bounded, so the row indices
 * have to be scaled. Rounding is outward — floor the top, ceil the bottom — so
 * a rounding error leaves a sliver of bar rather than clipping content.
 */
export const scaleBounds = (
  bounds: BorderBounds,
  probeHeight: number,
  actualHeight: number,
): BorderBounds => {
  if (probeHeight <= 0 || probeHeight === actualHeight) return bounds;
  const scale = actualHeight / probeHeight;
  return {
    top: Math.max(0, Math.floor(bounds.top * scale)),
    bottom: Math.min(actualHeight - 1, Math.ceil((bounds.bottom + 1) * scale) - 1),
  };
};

/** Pixel height of the content region. */
export const boundsHeight = (bounds: BorderBounds): number => bounds.bottom - bounds.top + 1;

/** How many rows would be removed, for showing the user what changed. */
export const trimmedRows = (bounds: BorderBounds, height: number): number =>
  height - boundsHeight(bounds);
