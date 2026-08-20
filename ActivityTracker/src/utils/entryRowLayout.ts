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
  /** gap under the large-mode gallery */
  galleryMarginBottom: 15,

  /** contentContainerStyle paddingTop on the list itself */
  listPaddingTop: 10,
  /** contentContainerStyle paddingHorizontal on the list itself */
  listPaddingHorizontal: 20,
} as const;

/**
 * How wide a row's content is, given the screen width.
 *
 * The list pads its sides, and the card pads its own. Both the row and the
 * height table work from this, so the gallery is laid out at the width its
 * height was calculated for.
 */
export const rowContentWidth = (screenWidth: number): number =>
  Math.max(0, screenWidth - ROW_METRICS.listPaddingHorizontal * 2 - ROW_METRICS.padding * 2);

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
  /**
   * Natural sizes of the row's images, in order, for the large mode.
   *
   * Null when any of them is still unknown, because the gallery takes the
   * height of its tallest image and one unmeasured image can be the tallest.
   */
  imageSizes?: { width: number; height: number }[] | null;
}

/**
 * Height reserved for a gallery whose photos have never been measured.
 *
 * Matches the gallery's own fallback, so an unmeasured row is drawn at exactly
 * the height the list reserved for it.
 */
export const FALLBACK_GALLERY_HEIGHT = 200;

/**
 * How tall the large-mode gallery will be.
 *
 * Each image fills the width, scaled down to fit but never up, and the gallery
 * takes the height of the tallest so that paging between them does not make
 * the card jump. This mirrors `fitToWidth`, which is what the gallery uses.
 *
 * Always returns a number. An earlier version returned null for "not known
 * yet", which propagated up and made the whole offset table null — so the list
 * lost its offsets the moment one row's photos were unmeasured, regained them
 * when they arrived, and lost them again on the next page. Switching a
 * virtualised list between table-based and measured layout mid-scroll leaves
 * it with frames it cannot reconcile; it ends up rendering a couple of rows
 * with collapsed spacers, which looks like the list emptying itself.
 *
 * A guess that is applied consistently is far better than no table: the row
 * imposes whatever height is returned here, so the guess is never *wrong* in
 * the sense that matters — it only makes that row taller or shorter than ideal
 * until its photos are measured.
 */
export const galleryHeightFor = (
  imageSizes: { width: number; height: number }[] | null | undefined,
  contentWidth: number,
): number => {
  if (contentWidth <= 0 || !imageSizes || imageSizes.length === 0) {
    return FALLBACK_GALLERY_HEIGHT;
  }

  let tallest = 0;
  for (const size of imageSizes) {
    if (!size || size.width <= 0 || size.height <= 0) return FALLBACK_GALLERY_HEIGHT;
    const scale = size.width > contentWidth ? contentWidth / size.width : 1;
    tallest = Math.max(tallest, Math.round(size.height * scale));
  }

  return tallest > 0 ? tallest : FALLBACK_GALLERY_HEIGHT;
};

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
 * The row's height. Always answerable, never a guess the row disagrees with:
 * the row sets its height from this same function.
 *
 * A large-mode row whose photos have not been measured yet gets the fallback
 * gallery height. It will be re-measured and this will change once, the first
 * time the row is seen — but it is a number from the outset, so the list never
 * has to fall back to measuring rows itself.
 */
export const entryRowHeight = (shape: RowShape, mode: ImageMode, contentWidth = 0): number => {
  const {
    padding,
    buttonsHeight,
    thumbnailSmall,
    thumbnailMedium,
    thumbnailStripMargin,
    galleryMarginBottom,
  } = ROW_METRICS;

  const text = Math.max(textBlockHeight(shape), buttonsHeight);

  if (mode === 'large' && shape.imageCount > 0) {
    const gallery = galleryHeightFor(shape.imageSizes, contentWidth);
    return padding * 2 + gallery + galleryMarginBottom + text;
  }

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
 * Always returns a table. Handing the list a table for some renders and
 * nothing for others is what produced the worst failure of all: the list would
 * place rows from offsets, lose them, place the next ones from its own
 * measurements, and end up rendering a two-row window with collapsed spacers
 * at the top of an otherwise empty screen.
 *
 * An index past the end can be asked for during the render in which a page is
 * appended. It answers with the last row's height rather than zero, because a
 * zero-length cell collapses the spacer that positions everything after it.
 */
export const buildItemLayout = (
  rows: SizedRow[],
  mode: ImageMode,
  contentWidth = 0,
): ((data: unknown, index: number) => { length: number; offset: number; index: number }) => {
  const lengths: number[] = [];
  const offsets: number[] = [];
  let cursor = ROW_METRICS.listPaddingTop;

  for (const row of rows) {
    // The cell the list measures includes the row's bottom margin.
    const length = entryRowHeight(row.shape, mode, contentWidth) + ROW_METRICS.marginBottom;
    offsets.push(cursor);
    lengths.push(length);
    cursor += length;
  }

  const trailingLength = lengths.length > 0 ? lengths[lengths.length - 1] : 0;

  return (_data: unknown, index: number) => {
    if (index < lengths.length) {
      return { length: lengths[index], offset: offsets[index], index };
    }
    const beyond = index - lengths.length;
    return {
      length: trailingLength,
      offset: cursor + beyond * trailingLength,
      index,
    };
  };
};
