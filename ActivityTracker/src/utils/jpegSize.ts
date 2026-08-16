/**
 * Read image dimensions straight out of a JPEG header.
 *
 * The gallery needs every image's aspect ratio up front so it can size itself
 * to the tallest one. The obvious way — `Image.getSize()` — fully *decodes*
 * each image just to measure it, which is what made opening an image-heavy
 * entry so expensive in the first place.
 *
 * A JPEG declares its dimensions in the SOF (Start Of Frame) marker, which sits
 * within the first few kilobytes. Parsing it costs a bounded read and no decode
 * at all, so measuring thirty images is cheaper than decoding one.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Enough to cover the SOF marker past any EXIF/ICC payload. */
export const HEADER_BYTES = 64 * 1024;

const read16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];

/**
 * Parse a JPEG header. Returns null if the bytes are not a JPEG, or if the SOF
 * marker was not within the slice provided (unusually large EXIF, say) —
 * callers should treat null as "unknown" and fall back, never as an error.
 */
export const readJpegSize = (bytes: Uint8Array): ImageSize | null => {
  // SOI
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resync on the next marker
      continue;
    }

    let marker = bytes[offset + 1];
    // Runs of 0xFF are legal padding before a marker.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }

    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null; // EOI without ever seeing an SOF
    if (offset + 3 >= bytes.length) return null;

    const segmentLength = read16(bytes, offset + 2);

    // SOF0-SOF15 hold the frame dimensions. C4 (DHT), C8 (JPG) and CC (DAC)
    // share the range but are not frame headers.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 9 >= bytes.length) return null;
      const height = read16(bytes, offset + 5);
      const width = read16(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if (segmentLength < 2) return null; // malformed
    offset += 2 + segmentLength;
  }

  return null;
};

/**
 * PNG fallback. The image store always writes JPEG, but a legacy inline image
 * imported from a clipboard paste can still be a PNG data URI.
 */
export const readPngSize = (bytes: Uint8Array): ImageSize | null => {
  if (bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return null;
  }
  // IHDR is always the first chunk: width and height are big-endian at 16..23.
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return width > 0 && height > 0 ? { width, height } : null;
};

export const readImageSize = (bytes: Uint8Array): ImageSize | null =>
  readJpegSize(bytes) ?? readPngSize(bytes);

/**
 * Fit `natural` into `containerWidth`, matching the original gallery: scale
 * down to fit the width, but never scale a small image up.
 *
 * IMPORTANT: `natural` must be the dimensions of the **full-size** image, not
 * the thumbnail. The thumbnail is a 400px proxy — its aspect ratio is correct
 * but its absolute size is not — and because this only ever scales down, a
 * 400px-wide thumbnail measured in an 800px container would be left at 400px
 * and render visibly shrunken.
 */
export const fitToWidth = (natural: ImageSize, containerWidth: number): ImageSize => {
  if (containerWidth <= 0 || natural.width <= 0) return natural;
  const scale = natural.width > containerWidth ? containerWidth / natural.width : 1;
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale),
  };
};

/**
 * Scale to exactly `containerWidth`, up or down, preserving aspect ratio.
 *
 * Used when only the thumbnail is available: its ratio is trustworthy but its
 * resolution is not, so filling the width is a better guess than pinning the
 * image to the proxy's pixel size.
 */
export const fillWidth = (ratio: ImageSize, containerWidth: number): ImageSize => {
  if (containerWidth <= 0 || ratio.width <= 0) return ratio;
  const scale = containerWidth / ratio.width;
  return {
    width: Math.round(ratio.width * scale),
    height: Math.round(ratio.height * scale),
  };
};
