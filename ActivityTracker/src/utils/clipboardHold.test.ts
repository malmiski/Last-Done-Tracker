/**
 * The copy -> delete -> paste sequence.
 *
 * Without a clipboard hold: copying an entry puts image *references* on the
 * clipboard, deleting that entry sees no database row referencing the blobs,
 * reclaims them, and the paste arrives with no photos. No corruption — paste
 * filters unresolvable refs — but the images are gone.
 *
 * A copy is therefore treated as a real reference to those blobs.
 */
// jest hoists mock factories above the file, so anything they close over must
// be prefixed `mock` to be allowed out of scope.
const mockMeta = new Map<string, string>();

jest.mock('./database', () => ({
  getMeta: jest.fn((key: string) => Promise.resolve(mockMeta.get(key) ?? null)),
  setMeta: jest.fn((key: string, value: string) => {
    mockMeta.set(key, value);
    return Promise.resolve();
  }),
  getAllImageRefs: jest.fn(() => Promise.resolve(new Set<string>())),
  getAllEntries: jest.fn(() => Promise.resolve([])),
}));

jest.mock('./imageStore', () => ({
  deleteRef: jest.fn(() => Promise.resolve()),
}));

import * as database from './database';
import * as imageStore from './imageStore';
import { HOLD_TTL_MS, clearHold, getHeldRefs, holdRefs, isHoldExpired } from './clipboardHold';
import { deleteUnreferencedRefs, getLiveRefs } from './imageOwnership';

const mockDb = database as unknown as jest.Mocked<typeof database>;
const mockStore = imageStore as unknown as jest.Mocked<typeof imageStore>;

const NOW = 1_700_000_000_000;

beforeEach(() => {
  mockMeta.clear();
  jest.clearAllMocks();
  mockDb.getAllImageRefs.mockResolvedValue(new Set<string>());
});

describe('holding refs', () => {
  it('records managed refs and reads them back', async () => {
    await holdRefs(['img:a', 'img:b'], NOW);
    expect(await getHeldRefs(NOW)).toEqual(new Set(['img:a', 'img:b']));
  });

  it('replaces the previous hold — only the latest copy is pasteable', async () => {
    await holdRefs(['img:a'], NOW);
    await holdRefs(['img:b'], NOW);
    expect(await getHeldRefs(NOW)).toEqual(new Set(['img:b']));
  });

  it('ignores inline and placeholder values', async () => {
    await holdRefs(['img:a', 'data:image/jpeg;base64,AAAA', 'legacy:e1'], NOW);
    expect(await getHeldRefs(NOW)).toEqual(new Set(['img:a']));
  });

  it('clears the hold when a copy carries no images', async () => {
    await holdRefs(['img:a'], NOW);
    await holdRefs([], NOW);
    expect(await getHeldRefs(NOW)).toEqual(new Set());
  });

  it('expires so an unpasted copy cannot pin photos forever', async () => {
    await holdRefs(['img:a'], NOW);
    expect(await getHeldRefs(NOW + HOLD_TTL_MS - 1000)).toEqual(new Set(['img:a']));
    expect(await getHeldRefs(NOW + HOLD_TTL_MS + 1000)).toEqual(new Set());
    expect(await isHoldExpired(NOW + HOLD_TTL_MS + 1000)).toBe(true);
  });

  it('treats a corrupt or missing hold as nothing held, never throwing', async () => {
    expect(await getHeldRefs(NOW)).toEqual(new Set());
    mockMeta.set('clipboard.imageHold', 'not json');
    expect(await getHeldRefs(NOW)).toEqual(new Set());
    mockMeta.set('clipboard.imageHold', '{"refs":"wrong type"}');
    expect(await getHeldRefs(NOW)).toEqual(new Set());
  });

  it('can be released explicitly', async () => {
    await holdRefs(['img:a'], NOW);
    await clearHold();
    expect(await getHeldRefs(NOW)).toEqual(new Set());
  });
});

describe('copy -> delete -> paste', () => {
  it('keeps the images alive after the copied entry is deleted', async () => {
    // 1. Copy entry A (its only image is img:shared).
    await holdRefs(['img:shared']);

    // 2. Delete entry A. No database row references the blob any more...
    mockDb.getAllImageRefs.mockResolvedValue(new Set());
    const deleted = await deleteUnreferencedRefs(['img:shared']);

    // ...but the clipboard does, so it survives for the paste.
    expect(deleted).toEqual([]);
    expect(mockStore.deleteRef).not.toHaveBeenCalled();
  });

  it('reclaims the images once the copy is superseded', async () => {
    await holdRefs(['img:shared']);
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    // Deleted while held: survives.
    expect(await deleteUnreferencedRefs(['img:shared'])).toEqual([]);

    // A different entry is copied, replacing the hold. Now nothing wants it.
    await holdRefs(['img:other']);
    expect(await deleteUnreferencedRefs(['img:shared'])).toEqual(['img:shared']);
    expect(mockStore.deleteRef).toHaveBeenCalledWith('img:shared');
  });

  it('reclaims the images once the hold expires', async () => {
    await holdRefs(['img:shared'], NOW);
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    // Simulate time passing beyond the TTL by writing an old timestamp.
    mockMeta.set(
      'clipboard.imageHold',
      JSON.stringify({ refs: ['img:shared'], at: NOW - HOLD_TTL_MS - 1 }),
    );

    expect(await deleteUnreferencedRefs(['img:shared'])).toEqual(['img:shared']);
  });

  it('still deletes blobs that were never on the clipboard', async () => {
    await holdRefs(['img:copied']);
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    const deleted = await deleteUnreferencedRefs(['img:copied', 'img:unrelated']);

    expect(deleted).toEqual(['img:unrelated']);
  });
});

describe('getLiveRefs', () => {
  it('unions database refs with clipboard-held refs', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set(['img:inDb']));
    await holdRefs(['img:onClipboard']);

    expect(await getLiveRefs()).toEqual(new Set(['img:inDb', 'img:onClipboard']));
  });

  it('is just the database refs when nothing is held', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set(['img:inDb']));
    expect(await getLiveRefs()).toEqual(new Set(['img:inDb']));
  });
});
