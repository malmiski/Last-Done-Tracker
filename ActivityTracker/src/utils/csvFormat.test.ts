import {
  CSV_HEADER,
  archiveNameFor,
  buildCsvRow,
  classifyImageValue,
  detectLayout,
  escapeCsv,
  parseArchiveName,
  parseCsvLine,
  parseCsvRow,
} from './csvFormat';

describe('archive naming', () => {
  /**
   * Images are stored in the archive under their own id, which is what lets an
   * import write them back under the same id so every `img:<id>` in the CSV
   * resolves with no remapping table. Round-tripping is the whole contract.
   */
  it('round-trips a reference through its archive filename', () => {
    expect(archiveNameFor('img:abc123', 'full')).toBe('abc123.jpg');
    expect(archiveNameFor('img:abc123', 'thumb')).toBe('abc123_thumb.jpg');

    expect(parseArchiveName('images/abc123.jpg')).toEqual({ id: 'abc123', variant: 'full' });
    expect(parseArchiveName('images/abc123_thumb.jpg')).toEqual({ id: 'abc123', variant: 'thumb' });
  });

  it('ignores non-image entries', () => {
    expect(archiveNameFor('data:image/jpeg;base64,AAAA', 'full')).toBeNull();
    expect(parseArchiveName('activities.db')).toBeNull();
    expect(parseArchiveName('data.csv')).toBeNull();
  });
});

describe('CSV escaping', () => {
  it('quotes fields containing commas or quotes', () => {
    expect(escapeCsv('plain')).toBe('plain');
    expect(escapeCsv('has,comma')).toBe('"has,comma"');
    expect(escapeCsv('has"quote')).toBe('"has""quote"');
    expect(escapeCsv(undefined)).toBe('');
  });

  it('flattens newlines so a row stays on one line', () => {
    expect(escapeCsv('line1\nline2')).toBe('line1 line2');
  });

  it('parses quoted fields back out', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c']);
  });
});

describe('row building', () => {
  const base = {
    activityId: 'a1',
    activityName: 'Running',
    icon: 'run',
    entryId: 'e1',
    startDate: new Date('2023-01-01T12:00:00Z'),
    endDate: new Date('2023-01-01T12:30:00Z'),
    notes: 'Felt good',
    tags: [{ id: 't1', name: 'Cardio', color: '#FF0000' }],
  };

  it('writes filenames rather than image data', () => {
    const row = buildCsvRow({ ...base, imageRefs: ['img:abc123'] });
    expect(row).toContain('abc123.jpg');
    expect(row).toContain('abc123_thumb.jpg');
    expect(row).not.toContain('img:');
    expect(row).toContain('Cardio:#FF0000');
  });

  it('passes legacy inline values through rather than dropping them', () => {
    // An unmigrated row must still export something usable, even if large.
    const row = buildCsvRow({ ...base, imageRefs: ['data:image/jpeg;base64,AAAA'] });
    expect(row).toContain('data:image/jpeg;base64,AAAA');
  });

  it('joins multiple images with a pipe', () => {
    const row = buildCsvRow({ ...base, imageRefs: ['img:a', 'img:b'] });
    expect(row).toContain('a.jpg|b.jpg');
  });
});

describe('layout detection and row parsing', () => {
  it('detects the current header', () => {
    expect(detectLayout(CSV_HEADER)).toEqual({
      hasIds: true,
      hasEndDate: true,
      hasTags: true,
      hasThumbnail: true,
    });
  });

  it('detects older headers without ids or end dates', () => {
    expect(detectLayout('Activity,Icon,Date,Notes,Image')).toEqual({
      hasIds: false,
      hasEndDate: false,
      hasTags: false,
      hasThumbnail: false,
    });
  });

  it('rejects a header missing required columns', () => {
    expect(detectLayout('Foo,Bar')).toBeNull();
  });

  it('parses a current-format row', () => {
    const layout = detectLayout(CSV_HEADER)!;
    const row = parseCsvRow(
      'a1,Running,run,e1,2023-01-01T12:00:00.000Z,2023-01-01T12:30:00.000Z,Felt good,abc.jpg,abc_thumb.jpg,Cardio:#FF0000',
      layout,
    )!;

    expect(row.activityId).toBe('a1');
    expect(row.entryId).toBe('e1');
    expect(row.notes).toBe('Felt good');
    expect(row.imageValues).toEqual(['abc.jpg']);
    expect(row.tagDefinitions).toEqual([{ name: 'Cardio', color: '#FF0000' }]);
    expect(row.endDate.toISOString()).toBe('2023-01-01T12:30:00.000Z');
  });

  it('defaults endDate to startDate on legacy rows', () => {
    const layout = detectLayout('ActivityID,Activity,Icon,EntryID,Date,Notes,Image')!;
    const row = parseCsvRow('a1,Running,run,e1,2023-01-01T12:00:00.000Z,Note,', layout)!;
    expect(row.startDate.toISOString()).toBe(row.endDate.toISOString());
  });

  it('skips blank and truncated lines instead of throwing', () => {
    const layout = detectLayout(CSV_HEADER)!;
    expect(parseCsvRow('', layout)).toBeNull();
    expect(parseCsvRow('   ', layout)).toBeNull();
    expect(parseCsvRow('a1,Running', layout)).toBeNull();
  });
});

describe('image value classification', () => {
  it('distinguishes the three shapes an Image column can hold', () => {
    expect(classifyImageValue('abc123.jpg')).toEqual({ kind: 'archive', id: 'abc123' });
    expect(classifyImageValue('img:abc123')).toEqual({ kind: 'ref', ref: 'img:abc123' });
    expect(classifyImageValue('data:image/jpeg;base64,AAAA')).toEqual({ kind: 'base64' });
    expect(classifyImageValue('nonsense')).toEqual({ kind: 'unknown' });
  });
});
