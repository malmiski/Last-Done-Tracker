/**
 * Turning a page of entries into rows the list can render.
 *
 * Two things each row needs that it cannot work out on its own: its number in
 * the activity's history, and the end time of the entry before it. Both depend
 * on neighbours, so they are computed once per data change rather than inside
 * the render callback — a render callback that closes over the entries array
 * gets a new identity every time a page loads, and that makes the list
 * re-render every mounted cell mid-scroll.
 */
import { ListEntry } from '../hooks/useEntries';
import {
  RowShape,
  hasDurationFor,
  hasSinceLastFor,
  notesFirstLine,
} from './entryRowLayout';
import { knownDimensions } from './imageDimensions';
import { ImageSize } from './jpegSize';

/** Looks up an image's natural size, or null if it is not known yet. */
export type DimensionLookup = (ref: string) => ImageSize | null;

/**
 * Sizes for a row's full-size images, or null if any of them is unknown.
 *
 * All or nothing: the gallery is as tall as its tallest image, so one
 * unmeasured image could be the one that decides the height.
 */
const imageSizesFor = (refs: string[] | undefined, lookup: DimensionLookup) => {
  if (!refs || refs.length === 0) return null;

  const sizes: ImageSize[] = [];
  for (const ref of refs) {
    const size = lookup(ref);
    if (!size) return null;
    sizes.push(size);
  }
  return sizes;
};

export interface EntryRow {
  entry: ListEntry;
  /** Oldest entry is 1; the newest carries the highest number. */
  displayIndex: number;
  /** The chronologically previous entry's end, for "since last time". */
  previousEndDate?: Date;
  /** What the row will contain, which is what decides how tall it is. */
  shape: RowShape;
}

/**
 * `entries` arrives newest first, so position 0 is the newest entry and takes
 * the highest number.
 *
 * The numbers are derived, never stored: deleting an entry renumbers the rest
 * by itself. `total` is the count the pagination reports, which is what makes
 * the first loaded row's number correct before the rest have been fetched. It
 * falls back to the loaded length if the count has not arrived yet, so the
 * numbering is never negative or zero.
 *
 * While a search is active `total` is the number of matches, so the numbers
 * run over the matching entries rather than the whole history — working out a
 * row's true position under a filter would need a separate query per row.
 */
export const buildEntryRows = (
  entries: ListEntry[],
  total: number,
  lookup: DimensionLookup = knownDimensions,
): EntryRow[] => {
  const highest = Math.max(total, entries.length);

  return entries.map((entry, index) => {
    const previousEndDate = entries[index + 1]?.endDate;
    // The gallery shows the full-size images, falling back to thumbnails for
    // older rows that only carry those.
    const galleryRefs = entry.images?.length ? entry.images : entry.thumbnails;

    return {
      entry,
      displayIndex: highest - index,
      previousEndDate,
      shape: {
        // Every row in this list is numbered.
        showsIndex: true,
        hasDuration: hasDurationFor(entry.startDate, entry.endDate),
        hasSinceLast: hasSinceLastFor(entry.startDate, previousEndDate),
        hasNotes: !!notesFirstLine(entry.notes),
        hasTags: (entry.tags?.length ?? 0) > 0,
        // Thumbnails and full images address the same photos; either list
        // gives the count, and older rows may only have one of them.
        imageCount: entry.thumbnails?.length || entry.images?.length || 0,
        imageSizes: imageSizesFor(galleryRefs, lookup),
      },
    };
  });
};
