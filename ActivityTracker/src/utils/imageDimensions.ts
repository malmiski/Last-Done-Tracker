/**
 * Image sizes, available synchronously.
 *
 * The entry list has to know how tall a row will be *before* it renders it.
 * Every route to an image's size is asynchronous — a header read, a database
 * lookup — so a list that asks at render time always paints once at the wrong
 * height and corrects a tick later. In the large-image mode that correction
 * changed which rows fell inside the render window, which changed the content
 * height again, and the screen shook until a scroll broke the cycle.
 *
 * So sizes are pulled in a batch when a page of entries loads, kept in a plain
 * Map, and read synchronously from there afterwards. Anything still unknown is
 * measured by the gallery as it always was and handed back here, which both
 * caches it for the rest of the session and writes it to the database so the
 * next launch already knows.
 *
 * Nothing here is a source of truth: every value can be read back out of the
 * file's own header. Losing the lot costs one measurement per image.
 */
import { ImageSize } from './jpegSize';
import * as database from './database';

const sizes = new Map<string, ImageSize>();

/** Refs already looked up, so a miss is not queried over and over. */
const queried = new Set<string>();

const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach(listener => listener());
};

/**
 * Subscribe to newly learned sizes.
 *
 * A row whose images were unknown when it was first laid out becomes sizeable
 * once they arrive, so the list rebuilds its offset table. That is the one
 * shift a row is allowed: the first time it is seen.
 */
export const subscribeToDimensions = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The image's natural size, or null if it has not been learned yet. */
export const knownDimensions = (ref?: string | null): ImageSize | null =>
  (ref ? sizes.get(ref) : undefined) ?? null;

/** Load whatever the database already knows about these refs. */
export const loadDimensionsFor = async (refs: string[]): Promise<void> => {
  const missing = refs.filter(ref => !!ref && !sizes.has(ref) && !queried.has(ref));
  if (missing.length === 0) return;

  missing.forEach(ref => queried.add(ref));

  let found: Record<string, ImageSize> = {};
  try {
    found = await database.getImageDimensions(missing);
  } catch {
    // Allow a retry on the next page load rather than never asking again.
    missing.forEach(ref => queried.delete(ref));
    return;
  }

  let learned = 0;
  Object.entries(found).forEach(([ref, size]) => {
    if (size && size.width > 0 && size.height > 0) {
      sizes.set(ref, size);
      learned += 1;
    }
  });

  if (learned > 0) notify();
};

/**
 * Record a size measured elsewhere — at import, where it is already known, or
 * by the gallery reading a header for a row nothing had measured yet.
 */
export const rememberDimensions = (ref: string, size: ImageSize): void => {
  if (!ref || !size || size.width <= 0 || size.height <= 0) return;

  const existing = sizes.get(ref);
  if (existing && existing.width === size.width && existing.height === size.height) return;

  sizes.set(ref, size);
  queried.add(ref);
  notify();

  // Fire and forget: the value is already usable, and persisting only saves
  // the next launch from measuring it again.
  void database.putImageDimensions([{ ref, width: size.width, height: size.height }]);
};

/** Test seam. */
export const resetDimensionCache = (): void => {
  sizes.clear();
  queried.clear();
};
