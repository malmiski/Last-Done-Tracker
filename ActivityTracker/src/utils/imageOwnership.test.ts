/**
 * Shared-image deletion safety.
 *
 * Copy/paste makes two entries reference one stored file. The failure this
 * guards against is the obvious one: deleting either entry wiping photos the
 * other is still displaying.
 */
jest.mock('./database', () => ({
  getAllImageRefs: jest.fn(),
  getAllEntries: jest.fn(),
}));

jest.mock('./imageStore', () => ({
  deleteRef: jest.fn(() => Promise.resolve()),
}));

// Clipboard holds are exercised in clipboardHold.test; here nothing is held so
// these tests describe database-only ownership.
jest.mock('./clipboardHold', () => ({
  getHeldRefs: jest.fn(() => Promise.resolve(new Set<string>())),
}));

import * as database from './database';
import * as imageStore from './imageStore';
import { countReferencesTo, deleteUnreferencedRefs } from './imageOwnership';

const mockDb = database as unknown as jest.Mocked<typeof database>;
const mockStore = imageStore as unknown as jest.Mocked<typeof imageStore>;

beforeEach(() => jest.clearAllMocks());

describe('deleteUnreferencedRefs', () => {
  it('keeps a file that another entry still references', async () => {
    // Entry A deleted; entry B was pasted from it and still points at img:shared.
    mockDb.getAllImageRefs.mockResolvedValue(new Set(['img:shared']));

    const deleted = await deleteUnreferencedRefs(['img:shared']);

    expect(deleted).toEqual([]);
    expect(mockStore.deleteRef).not.toHaveBeenCalled();
  });

  it('deletes a file once nothing references it', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    const deleted = await deleteUnreferencedRefs(['img:orphan']);

    expect(deleted).toEqual(['img:orphan']);
    expect(mockStore.deleteRef).toHaveBeenCalledWith('img:orphan');
  });

  it('deletes only the orphans out of a mixed set', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set(['img:kept']));

    const deleted = await deleteUnreferencedRefs(['img:kept', 'img:gone', 'img:alsogone']);

    expect(deleted.sort()).toEqual(['img:alsogone', 'img:gone']);
    expect(mockStore.deleteRef).toHaveBeenCalledTimes(2);
    expect(mockStore.deleteRef).not.toHaveBeenCalledWith('img:kept');
  });

  it('deduplicates a reference listed for both variants', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    await deleteUnreferencedRefs(['img:a', 'img:a']);

    expect(mockStore.deleteRef).toHaveBeenCalledTimes(1);
  });

  it('ignores legacy inline values and placeholders', async () => {
    mockDb.getAllImageRefs.mockResolvedValue(new Set());

    const deleted = await deleteUnreferencedRefs([
      'data:image/jpeg;base64,AAAA',
      'legacy:entry-1',
      'failed',
    ]);

    expect(deleted).toEqual([]);
    // Nothing managed to delete, so the live set is never even queried.
    expect(mockDb.getAllImageRefs).not.toHaveBeenCalled();
    expect(mockStore.deleteRef).not.toHaveBeenCalled();
  });

  it('does nothing when handed an empty list', async () => {
    expect(await deleteUnreferencedRefs([])).toEqual([]);
    expect(mockStore.deleteRef).not.toHaveBeenCalled();
  });

  it('survives a delete-both-entries sequence without losing then resurrecting files', async () => {
    // First entry goes: the shared image survives because the second still holds it.
    mockDb.getAllImageRefs.mockResolvedValueOnce(new Set(['img:shared']));
    expect(await deleteUnreferencedRefs(['img:shared'])).toEqual([]);

    // Second entry goes: now nothing references it, so it is reclaimed.
    mockDb.getAllImageRefs.mockResolvedValueOnce(new Set());
    expect(await deleteUnreferencedRefs(['img:shared'])).toEqual(['img:shared']);
  });
});

describe('countReferencesTo', () => {
  it('counts entries sharing one image', async () => {
    mockDb.getAllEntries.mockResolvedValue([
      { images: ['img:shared'], thumbnails: ['img:shared'] },
      { images: ['img:shared'], thumbnails: ['img:shared'] },
      { images: ['img:other'], thumbnails: ['img:other'] },
    ] as any);

    expect(await countReferencesTo('img:shared')).toBe(2);
  });

  it('returns zero for a value that is not a managed reference', async () => {
    expect(await countReferencesTo('data:image/jpeg;base64,AAAA')).toBe(0);
    expect(mockDb.getAllEntries).not.toHaveBeenCalled();
  });
});
