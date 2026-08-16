jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve(true)),
  getStringAsync: jest.fn(() => Promise.resolve('')),
}));

jest.mock('./imageStore', () => ({
  resolveImageUri: jest.fn((ref: string) =>
    Promise.resolve(ref === 'img:missing' ? null : `file:///images/${ref.slice(4)}.jpg`),
  ),
}));

import * as Clipboard from 'expo-clipboard';
import {
  buildPayload,
  copyEntryToClipboard,
  mergeImageRefs,
  mergeTags,
  parsePayload,
  readEntryFromClipboard,
  resolveAvailableImages,
  serialisePayload,
} from './entryClipboard';
import { Tag } from '../data/activity-details';

const tag = (name: string, color = '#FF0000'): Tag => ({ id: `id-${name}`, name, color });

const sampleEntry = {
  startDate: new Date('2023-05-01T09:00:00.000Z'),
  endDate: new Date('2023-05-01T10:30:00.000Z'),
  notes: 'Morning session',
  images: ['img:aaa', 'img:bbb'],
  tags: [tag('Cardio'), tag('Outdoor', '#00FF00')],
};

describe('payload round trip', () => {
  it('survives serialise -> parse intact', () => {
    const payload = buildPayload(sampleEntry, 'Running');
    const parsed = parsePayload(serialisePayload(payload));

    expect(parsed).not.toBeNull();
    expect(parsed!.notes).toBe('Morning session');
    expect(parsed!.images).toEqual(['img:aaa', 'img:bbb']);
    expect(parsed!.tags).toEqual([
      { name: 'Cardio', color: '#FF0000' },
      { name: 'Outdoor', color: '#00FF00' },
    ]);
    expect(new Date(parsed!.startDate).toISOString()).toBe('2023-05-01T09:00:00.000Z');
    expect(parsed!.sourceActivityName).toBe('Running');
  });

  it('carries image references, never image data', () => {
    // The whole point: a clipboard string stays tiny however many photos the
    // entry has. Embedding base64 would be megabytes.
    const serialised = serialisePayload(buildPayload(sampleEntry));
    expect(serialised).not.toContain('base64');
    expect(serialised.length).toBeLessThan(500);
  });

  it('drops inline base64 rather than copying an unmigrated image', () => {
    const payload = buildPayload({
      ...sampleEntry,
      images: ['img:aaa', 'data:image/jpeg;base64,AAAA', 'legacy:entry-1'],
    });
    expect(payload.images).toEqual(['img:aaa']);
  });
});

describe('parsePayload rejects foreign clipboard content', () => {
  it('ignores plain text', () => {
    expect(parsePayload('just some notes I copied')).toBeNull();
    expect(parsePayload('')).toBeNull();
    expect(parsePayload(null)).toBeNull();
    expect(parsePayload(undefined)).toBeNull();
  });

  it('ignores unrelated JSON', () => {
    expect(parsePayload('{"foo":"bar"}')).toBeNull();
    expect(parsePayload('[1,2,3]')).toBeNull();
  });

  it('ignores malformed JSON that mentions the marker', () => {
    expect(parsePayload('{"marker":"lastDoneTracker.entry"')).toBeNull();
  });

  it('ignores a payload from a newer app version', () => {
    const future = { ...buildPayload(sampleEntry), version: 99 };
    expect(parsePayload(JSON.stringify(future))).toBeNull();
  });

  it('ignores a payload with unusable dates', () => {
    const broken = { ...buildPayload(sampleEntry), startDate: 'not a date' };
    expect(parsePayload(JSON.stringify(broken))).toBeNull();
  });

  it('tolerates missing optional fields', () => {
    const minimal = {
      marker: 'lastDoneTracker.entry',
      version: 1,
      startDate: '2023-05-01T09:00:00.000Z',
      endDate: '2023-05-01T09:00:00.000Z',
    };
    const parsed = parsePayload(JSON.stringify(minimal));
    expect(parsed).not.toBeNull();
    expect(parsed!.images).toEqual([]);
    expect(parsed!.tags).toEqual([]);
    expect(parsed!.notes).toBeUndefined();
  });
});

describe('clipboard IO', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes a parseable payload and reports the image count', async () => {
    const count = await copyEntryToClipboard(sampleEntry, 'Running');
    expect(count).toBe(2);

    const written = (Clipboard.setStringAsync as jest.Mock).mock.calls[0][0];
    expect(parsePayload(written)).not.toBeNull();
  });

  it('surfaces a blocked clipboard read rather than throwing', async () => {
    (Clipboard.getStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    const result = await readEntryFromClipboard();
    expect(result.payload).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('returns null payload for unrelated clipboard text without erroring', async () => {
    (Clipboard.getStringAsync as jest.Mock).mockResolvedValueOnce('hello world');
    const result = await readEntryFromClipboard();
    expect(result.payload).toBeNull();
    expect(result.error).toBeUndefined();
  });
});

describe('resolveAvailableImages', () => {
  it('separates references this device can resolve from ones it cannot', async () => {
    // The cross-device case: the JSON travels via Universal Clipboard but the
    // image files do not exist in this device's store.
    const result = await resolveAvailableImages(['img:aaa', 'img:missing', 'img:bbb']);
    expect(result.available).toEqual(['img:aaa', 'img:bbb']);
    expect(result.missing).toBe(1);
  });
});

describe('mergeImageRefs', () => {
  it('appends copied images after existing ones', () => {
    expect(mergeImageRefs(['img:a'], ['img:b', 'img:c'])).toEqual(['img:a', 'img:b', 'img:c']);
  });

  it('does not duplicate a reference already on the entry', () => {
    // Pasting into the entry you copied from must not double its photos.
    expect(mergeImageRefs(['img:a', 'img:b'], ['img:b', 'img:c'])).toEqual([
      'img:a',
      'img:b',
      'img:c',
    ]);
  });

  it('leaves the entry untouched when there is nothing to add', () => {
    expect(mergeImageRefs(['img:a'], [])).toEqual(['img:a']);
  });
});

describe('mergeTags', () => {
  const resolveFrom = (available: Tag[]) => (name: string) =>
    available.find(candidate => candidate.name.toLowerCase() === name.toLowerCase());

  it('adds tags that are missing and keeps the existing ones', () => {
    const { merged, missing } = mergeTags(
      [tag('Cardio')],
      [{ name: 'Outdoor', color: '#00FF00' }],
      resolveFrom([tag('Outdoor', '#00FF00')]),
    );
    expect(merged.map(t => t.name)).toEqual(['Cardio', 'Outdoor']);
    expect(missing).toEqual([]);
  });

  it('does not duplicate a tag the entry already has', () => {
    const { merged } = mergeTags(
      [tag('Cardio')],
      [{ name: 'Cardio', color: '#FF0000' }],
      resolveFrom([tag('Cardio')]),
    );
    expect(merged).toHaveLength(1);
  });

  it('matches existing tags case-insensitively', () => {
    const { merged } = mergeTags(
      [tag('Cardio')],
      [{ name: 'cardio', color: '#FF0000' }],
      resolveFrom([tag('Cardio')]),
    );
    expect(merged).toHaveLength(1);
  });

  it('reports tags that need creating on this device', () => {
    const { merged, missing } = mergeTags(
      [],
      [{ name: 'Brand New', color: '#123456' }],
      resolveFrom([]),
    );
    expect(merged).toEqual([]);
    expect(missing).toEqual([{ name: 'Brand New', color: '#123456' }]);
  });
});
