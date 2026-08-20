/**
 * How tall an entry row is, worked out before it is rendered.
 *
 * Why this exists: a virtualised list that cannot be told where its rows are
 * has to guess, render, measure, and then correct itself. The correction moves
 * the content under the user's finger. Worse, when a correction changes which
 * rows fall inside the render window, the list can settle into a loop —
 * mounting a row makes the content taller, which pushes that row out of the
 * window, which makes it shorter again — and the screen oscillates until a
 * scroll breaks the cycle.
 *
 * The way out is for row height to be a pure function of the row's data. That
 * requires nothing in the row to re-wrap when the available width changes, so
 * the date line and the tag strip are both held to a single line. Everything
 * else was already single-line or absent.
 *
 * The numbers below are the row's real style values. They are used twice: the
 * component sets its own height from them, and the list uses them for
 * getItemLayout. Since the component *imposes* the height rather than letting
 * content decide it, the two cannot disagree — which matters, because a
 * getItemLayout that is wrong is worse than none at all.
 *
 * Every text style involved declares an explicit lineHeight. Without one, the
 * line box depends on the platform's font metrics, and the same row would be a
 * different height on iOS, Android and web.
 */

export type ImageMode = 'small' | 'medium' | 'large' | 'hidden';

export const ROW_METRICS = {
  /** container padding, applied on all four sides */
  padding: 15,
  /** gap below each row */
  marginBottom: 15,
  /** the edit and delete icons */
  buttonsHeight: 24,

  index: { fontSize: 11, lineHeight: 14, marginBottom: 2 },
  date: { fontSize: 14, lineHeight: 18 },
  duration: { fontSize: 12, lineHeight: 15, marginTop: 2 },
  sinceLast: { fontSize: 12, lineHeight: 15, marginTop: 2 },
  notes: { fontSize: 14, lineHeight: 18, marginTop: 5 },
  /** tag pill: 3pt padding above and below a 13pt line */
  tags: { lineHeight: 13, paddingVertical: 3, marginTop: 5 },

  thumbnailSmall: 50,
  thumbnailMedium: 100,
  /** gap under the horizontal thumbnail strip */
  thumbnailStripMargin: 15,

  /** contentContainerStyle paddingTop on the list itself */
  listPaddingTop: 10,
} as const;

export const TAG_ROW_HEIGHT = ROW_METRICS.tags.lineHeight + ROW_METRICS.tags.paddingVertical * 2;

/**
 * Whether a row shows a duration.
 *
 * Exported and used by the component to decide whether to render it, so the
 * predicate that drives the height and the one that drives the markup are
 * the same predicate and cannot drift apart.
 */
export const hasDurationFor = (start: Date, end: Date): boolean =>
  end.getTime() - start.getTime() > 0;

/** Whether a row shows "... since last time". */
export const hasSinceLastFor = (start: Date, previousEnd?: Date): boolean =>
  !!previousEnd && start.getTime() - previousEnd.getTime() > 0;

/** The one line of the notes a row previews. Empty means no notes line. */
export const notesFirstLine = (notes?: string): string => (notes ? notes.split('\n')[0] : '');

/** Everything about a row that changes its height. */
export interface RowShape {
  showsIndex: boolean;
  hasDuration: boolean;
  hasSinceLast: boolean;
  hasNotes: boolean;
  hasTags: boolean;
  /** Thumbnails available for the small and medium modes. */
  imageCount: number;
}

const textBlockHeight = (shape: RowShape): number => {
  const { index, date, duration, sinceLast, notes, tags } = ROW_METRICS;

  let height = date.lineHeight;
  if (shape.showsIndex) height += index.lineHeight + index.marginBottom;
  if (shape.hasDuration) height += duration.lineHeight + duration.marginTop;
  if (shape.hasSinceLast) height += sinceLast.lineHeight + sinceLast.marginTop;
  if (shape.hasNotes) height += notes.lineHeight + notes.marginTop;
  if (shape.hasTags) height += TAG_ROW_HEIGHT + tags.marginTop;

  return height;
};

/**
 * The row's height, or null when it cannot be known ahead of time.
 *
 * "large" mode is the null case: the gallery sizes itself from the aspect
 * ratios of images that have not been read yet. That mode shows one or two
 * rows per screen, so leaving it to measurement costs little.
 */
export const entryRowHeight = (shape: RowShape, mode: ImageMode): number | null => {
  if (mode === 'large' && shape.imageCount > 0) return null;

  const { padding, buttonsHeight, thumbnailSmall, thumbnailMedium, thumbnailStripMargin } =
    ROW_METRICS;

  const text = Math.max(textBlockHeight(shape), buttonsHeight);
  const thumbnail = mode === 'medium' ? thumbnailMedium : thumbnailSmall;
  const showsThumbnails = (mode === 'small' || mode === 'medium') && shape.imageCount > 0;

  // More than one image puts the strip on its own line above the text; a
  // single image sits beside it, so it only matters if it is the taller of
  // the two.
  const body = !showsThumbnails
    ? text
    : shape.imageCount > 1
      ? thumbnail + thumbnailStripMargin + text
      : Math.max(text, thumbnail);

  return padding * 2 + body;
};

/** What the list needs from each row to size it. */
export interface SizedRow {
  shape: RowShape;
}

/**
 * Cumulative offsets for FlatList's getItemLayout.
 *
 * Returns null when any row in the list cannot be sized ahead of time, because
 * a partly-correct layout is worse than none: the list would place some rows
 * from the table and others from measurement, and they would not line up.
 */
export const buildItemLayout = (
  rows: SizedRow[],
  mode: ImageMode,
): ((data: unknown, index: number) => { length: number; offset: number; index: number }) | null => {
  const lengths: number[] = [];
  const offsets: number[] = [];
  let cursor = ROW_METRICS.listPaddingTop;

  for (const row of rows) {
    const height = entryRowHeight(row.shape, mode);
    if (height === null) return null;

    // The cell the list measures includes the row's bottom margin.
    const length = height + ROW_METRICS.marginBottom;
    offsets.push(cursor);
    lengths.push(length);
    cursor += length;
  }

  return (_data: unknown, index: number) => ({
    length: lengths[index] ?? 0,
    offset: offsets[index] ?? cursor,
    index,
  });
};
