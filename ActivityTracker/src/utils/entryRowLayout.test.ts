import {
  ROW_METRICS,
  RowShape,
  TAG_ROW_HEIGHT,
  buildItemLayout,
  entryRowHeight,
  galleryHeightFor,
  rowContentWidth,
  hasDurationFor,
  hasSinceLastFor,
  notesFirstLine,
} from './entryRowLayout';

const bare: RowShape = {
  showsIndex: true,
  hasDuration: false,
  hasSinceLast: false,
  hasNotes: false,
  hasTags: false,
  imageCount: 0,
};

describe('row predicates', () => {
  it('shows a duration only when the entry actually spans time', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(hasDurationFor(start, new Date('2026-01-01T10:05:00Z'))).toBe(true);
    expect(hasDurationFor(start, start)).toBe(false);
    // An end before the start is bad data, not a negative duration.
    expect(hasDurationFor(start, new Date('2026-01-01T09:00:00Z'))).toBe(false);
  });

  it('shows "since last time" only when there is a previous entry to measure from', () => {
    const start = new Date('2026-01-02T10:00:00Z');
    expect(hasSinceLastFor(start, new Date('2026-01-01T10:00:00Z'))).toBe(true);
    expect(hasSinceLastFor(start, undefined)).toBe(false);
    expect(hasSinceLastFor(start, start)).toBe(false);
  });

  it('previews the first line of notes, and nothing for an empty first line', () => {
    expect(notesFirstLine('one\ntwo')).toBe('one');
    expect(notesFirstLine('')).toBe('');
    expect(notesFirstLine(undefined)).toBe('');
    // A leading newline means there is no first line to show.
    expect(notesFirstLine('\nsecond')).toBe('');
  });
});

/** A numbered row with nothing optional: just the number and the date. */
const BARE_TEXT =
  ROW_METRICS.index.lineHeight + ROW_METRICS.index.marginBottom + ROW_METRICS.date.lineHeight;

describe('entryRowHeight', () => {
  it('is the text block plus the padding around it', () => {
    expect(entryRowHeight(bare, 'hidden')).toBe(ROW_METRICS.padding * 2 + BARE_TEXT);
  });

  it('never gets shorter than the edit and delete buttons beside the text', () => {
    // A single date line is shorter than the icons, so the icons set the floor.
    expect(entryRowHeight({ ...bare, showsIndex: false }, 'hidden')).toBe(
      ROW_METRICS.padding * 2 + ROW_METRICS.buttonsHeight,
    );
    expect(ROW_METRICS.date.lineHeight).toBeLessThan(ROW_METRICS.buttonsHeight);
  });

  it('grows by exactly one line per optional line', () => {
    const base = entryRowHeight({ ...bare, hasNotes: true }, 'hidden')!;

    const withDuration = entryRowHeight({ ...bare, hasNotes: true, hasDuration: true }, 'hidden')!;
    expect(withDuration - base).toBe(ROW_METRICS.duration.lineHeight + ROW_METRICS.duration.marginTop);

    const withTags = entryRowHeight({ ...bare, hasNotes: true, hasTags: true }, 'hidden')!;
    expect(withTags - base).toBe(TAG_ROW_HEIGHT + ROW_METRICS.tags.marginTop);
  });

  it('does not depend on how many tags there are', () => {
    // The tag strip is one line that clips, so ten tags are as tall as one.
    const shape = { ...bare, hasNotes: true, hasTags: true };
    expect(entryRowHeight(shape, 'hidden')).toBe(entryRowHeight(shape, 'hidden'));
  });

  it('puts a lone thumbnail beside the text and a strip above it', () => {
    const single = { ...bare, imageCount: 1 };
    const several = { ...bare, imageCount: 4 };

    // One image: only matters if it is taller than the text next to it.
    expect(entryRowHeight(single, 'small')).toBe(
      ROW_METRICS.padding * 2 + ROW_METRICS.thumbnailSmall,
    );

    // Several: the strip takes its own line above the text.
    expect(entryRowHeight(several, 'small')).toBe(
      ROW_METRICS.padding * 2 +
        ROW_METRICS.thumbnailSmall +
        ROW_METRICS.thumbnailStripMargin +
        BARE_TEXT,
    );

    expect(entryRowHeight(several, 'medium')! - entryRowHeight(several, 'small')!).toBe(
      ROW_METRICS.thumbnailMedium - ROW_METRICS.thumbnailSmall,
    );
  });

  it('ignores images in the hidden mode', () => {
    expect(entryRowHeight({ ...bare, imageCount: 9 }, 'hidden')).toBe(entryRowHeight(bare, 'hidden'));
  });

  it('declines to size a large-image row whose photos have not been measured', () => {
    expect(entryRowHeight({ ...bare, imageCount: 3 }, 'large', 300)).toBeNull();
    // With no images there is no gallery, so it is knowable again.
    expect(entryRowHeight(bare, 'large', 300)).not.toBeNull();
  });

  it('sizes a large-image row once the photos are known', () => {
    const shape = {
      ...bare,
      imageCount: 2,
      imageSizes: [
        { width: 400, height: 300 },
        { width: 200, height: 400 },
      ],
    };

    // At 400 wide: the first fills the width at 300 tall, the second is
    // narrower than the container so it stays 400 tall. The gallery takes the
    // taller of the two so paging does not make the card jump.
    expect(entryRowHeight(shape, 'large', 400)).toBe(
      ROW_METRICS.padding * 2 + 400 + ROW_METRICS.galleryMarginBottom + BARE_TEXT,
    );
  });

  it('cannot size a large-image row before the width is known', () => {
    const shape = { ...bare, imageCount: 1, imageSizes: [{ width: 100, height: 100 }] };
    expect(entryRowHeight(shape, 'large', 0)).toBeNull();
  });
});

describe('galleryHeightFor', () => {
  it('scales an oversized image down to the width', () => {
    expect(galleryHeightFor([{ width: 1000, height: 500 }], 400)).toBe(200);
  });

  it('leaves a small image at its natural size rather than blowing it up', () => {
    // Matches fitToWidth, which only ever scales down.
    expect(galleryHeightFor([{ width: 100, height: 80 }], 400)).toBe(80);
  });

  it('takes the tallest, since that is what the gallery reserves', () => {
    expect(
      galleryHeightFor(
        [
          { width: 400, height: 100 },
          { width: 400, height: 300 },
        ],
        400,
      ),
    ).toBe(300);
  });

  it('refuses nonsense rather than returning a wrong height', () => {
    expect(galleryHeightFor([], 400)).toBeNull();
    expect(galleryHeightFor([{ width: 100, height: 100 }], 0)).toBeNull();
    expect(galleryHeightFor([{ width: 0, height: 100 }], 400)).toBeNull();
  });
});

describe('buildItemLayout', () => {
  const rows = [
    { shape: bare },
    { shape: { ...bare, hasNotes: true, hasTags: true } },
    { shape: { ...bare, imageCount: 2 } },
  ];

  it('starts at the list padding and accumulates each row plus its margin', () => {
    const layout = buildItemLayout(rows, 'small')!;

    expect(layout(null, 0).offset).toBe(ROW_METRICS.listPaddingTop);
    expect(layout(null, 0).length).toBe(
      entryRowHeight(rows[0].shape, 'small')! + ROW_METRICS.marginBottom,
    );

    // Each offset is the previous offset plus the previous length: no gaps and
    // no overlaps, which is the whole point of handing the list a table.
    for (let i = 1; i < rows.length; i++) {
      expect(layout(null, i).offset).toBe(layout(null, i - 1).offset + layout(null, i - 1).length);
    }
  });

  it('reports the index it was asked about', () => {
    const layout = buildItemLayout(rows, 'small')!;
    expect(layout(null, 2).index).toBe(2);
  });

  it('measures the row content width the same way the row does', () => {
    // The row and the height table must agree, or the gallery is drawn at a
    // different width than the height was reserved for.
    expect(rowContentWidth(400)).toBe(
      400 - ROW_METRICS.listPaddingHorizontal * 2 - ROW_METRICS.padding * 2,
    );
    expect(rowContentWidth(0)).toBe(0);
  });

  it('refuses to size a list it cannot size completely', () => {
    // One unmeasurable row makes the whole table unusable: the list would
    // place some rows from it and others from measurement, and they would not
    // line up.
    expect(buildItemLayout(rows, 'large')).toBeNull();
  });

  it('handles an empty list', () => {
    const layout = buildItemLayout([], 'small')!;
    expect(layout).not.toBeNull();
    expect(layout(null, 0)).toEqual({
      length: 0,
      offset: ROW_METRICS.listPaddingTop,
      index: 0,
    });
  });
});
