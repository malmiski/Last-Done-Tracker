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

export interface EntryRow {
  entry: ListEntry;
  /** Oldest entry is 1; the newest carries the highest number. */
  displayIndex: number;
  /** The chronologically previous entry's end, for "since last time". */
  previousEndDate?: Date;
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
export const buildEntryRows = (entries: ListEntry[], total: number): EntryRow[] => {
  const highest = Math.max(total, entries.length);

  return entries.map((entry, index) => ({
    entry,
    displayIndex: highest - index,
    previousEndDate: entries[index + 1]?.endDate,
  }));
};
