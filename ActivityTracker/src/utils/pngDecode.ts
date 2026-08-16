/**
 * Minimal PNG decoder, used only to read pixels on native.
 *
 * Why this exists: detecting letterbox bars needs pixel access, and neither
 * expo-image-manipulator nor expo-image exposes any. The workaround is to have
 * the manipulator render a very narrow proxy of the image as PNG, then decode
 * that here. A proxy 8px wide by the image's full height is ~50KB of pixels,
 * so this never decodes anything large.
 *
 * Scope is deliberately narrow: 8-bit RGB and RGBA, non-interlaced, which is
 * what the manipulator produces. Anything else returns null and the caller
 * skips cropping rather than guessing.
 *
 * Uses fflate's inflate, already a dependency for the backup zip.
 */
import { unzlibSync } from 'fflate';

export interface PixelBuffer {
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const readUint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/**
 * Decode a PNG to RGBA. Returns null for anything outside the supported
 * subset, or for malformed input — callers treat null as "cannot inspect".
 */
export const decodePng = (bytes: Uint8Array): PixelBuffer | null => {
  if (bytes.length < 8 + 25) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) return null;

    if (type === 'IHDR') {
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (width <= 0 || height <= 0) return null;
  if (bitDepth !== 8) return null;
  if (interlace !== 0) return null;
  // 2 = RGB, 6 = RGBA. Palette and greyscale are not produced by our pipeline.
  if (colorType !== 2 && colorType !== 6) return null;
  if (idatParts.length === 0) return null;

  const channels = colorType === 6 ? 4 : 3;

  let compressed: Uint8Array;
  if (idatParts.length === 1) {
    compressed = idatParts[0];
  } else {
    const total = idatParts.reduce((sum, part) => sum + part.length, 0);
    compressed = new Uint8Array(total);
    let cursor = 0;
    for (const part of idatParts) {
      compressed.set(part, cursor);
      cursor += part.length;
    }
  }

  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch {
    return null;
  }

  const rowBytes = width * channels;
  if (raw.length < (rowBytes + 1) * height) return null;

  // Unfiltered scanlines, still in the source channel count.
  const out = new Uint8Array(rowBytes * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * rowBytes;
    const prevStart = rowStart - rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = x >= channels && y > 0 ? out[prevStart + x - channels] : 0;
      const value = raw[pos++];

      let restored: number;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paeth(left, up, upLeft); break;
        default: return null; // unknown filter: refuse rather than corrupt
      }
      out[rowStart + x] = restored & 0xff;
    }
  }

  if (channels === 4) return { data: out, width, height };

  // Expand RGB to RGBA so callers only handle one layout.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i];
    rgba[j + 1] = out[i + 1];
    rgba[j + 2] = out[i + 2];
    rgba[j + 3] = 255;
  }
  return { data: rgba, width, height };
};
