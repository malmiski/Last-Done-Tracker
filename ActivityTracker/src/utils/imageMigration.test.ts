/**
 * The migration is the riskiest code on this branch: it runs unattended over a
 * user's whole photo library, and the two failure modes that matter are
 * (a) loading too much at once, which is the bug being fixed, and (b) wedging
 * in a loop on a row it cannot convert.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  InteractionManager: { runAfterInteractions: (fn: () => void) => fn() },
}));

/*
 * Explicit factories rather than `jest.mock('./database')`: automocking still
 * loads the real module to derive its shape, which drags in expo-sqlite and
 * expo-constants and blows up under jest-expo. Naming the surface keeps this
 * suite fast and hermetic.
 */
jest.mock('./database', () => ({
  countUnmigratedEntries: jest.fn(),
  getUnmigratedEntryIds: jest.fn(),
  getRawEntryImages: jest.fn(),
  markEntryMigrated: jest.fn(),
  getAllImageRefs: jest.fn(),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
  compactDatabase: jest.fn(),
}));

jest.mock('./imageStore', () => ({
  importFromBase64: jest.fn(),
  collectGarbage: jest.fn(),
}));

import * as database from './database';
import * as imageStore from './imageStore';
import { runImageMigration } from './imageMigration';

const mockDb = database as unknown as jest.Mocked<typeof database>;
const mockStore = imageStore as unknown as jest.Mocked<typeof imageStore>;

const BIG_BASE64 = `data:image/jpeg;base64,${'A'.repeat(5000)}`;

/** Wire up a fake database holding the given rows. */
const givenEntries = (rows: Record<string, { images: string[]; thumbnails: string[] }>) => {
  const remaining = new Set(Object.keys(rows));

  mockDb.countUnmigratedEntries.mockImplementation(async () => remaining.size);
  mockDb.getUnmigratedEntryIds.mockImplementation(async (limit: number) =>
    [...remaining].slice(0, limit),
  );
  mockDb.getRawEntryImages.mockImplementation(async (id: string) => rows[id] ?? null);
  mockDb.markEntryMigrated.mockImplementation(async (id: string) => {
    remaining.delete(id);
  });
  mockDb.getAllImageRefs.mockResolvedValue(new Set());
  mockDb.getMeta.mockResolvedValue(null);
  mockDb.setMeta.mockResolvedValue(undefined);
  mockDb.compactDatabase.mockResolvedValue(undefined);
  mockStore.collectGarbage.mockResolvedValue(0);

  return remaining;
};

describe('image migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let counter = 0;
    mockStore.importFromBase64.mockImplementation(async () => ({
      ref: `img:converted${counter++}`,
      width: 100,
      height: 100,
      bytes: 1000,
    }));
  });

  it('converts inline base64 to references and marks the row done', async () => {
    givenEntries({ e1: { images: [BIG_BASE64], thumbnails: [BIG_BASE64] } });

    await runImageMigration();

    expect(mockStore.importFromBase64).toHaveBeenCalledTimes(1);
    // Both columns get the same reference: one ref addresses both variants.
    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith('e1', ['img:converted0'], ['img:converted0']);
  });

  it('reads one entry at a time rather than loading them all', async () => {
    givenEntries({
      e1: { images: [BIG_BASE64], thumbnails: [] },
      e2: { images: [BIG_BASE64], thumbnails: [] },
      e3: { images: [BIG_BASE64], thumbnails: [] },
    });

    await runImageMigration();

    // The discovery query must never return image data -- only ids.
    expect(mockDb.getUnmigratedEntryIds).toHaveBeenCalled();
    expect(mockDb.getRawEntryImages).toHaveBeenCalledTimes(3);
    expect(mockDb.markEntryMigrated).toHaveBeenCalledTimes(3);
  });

  it('leaves already-converted references untouched', async () => {
    givenEntries({ e1: { images: ['img:existing'], thumbnails: ['img:existing'] } });

    await runImageMigration();

    expect(mockStore.importFromBase64).not.toHaveBeenCalled();
    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith('e1', ['img:existing'], ['img:existing']);
  });

  it('falls back to the thumbnail column when there is no full image', async () => {
    givenEntries({ e1: { images: [], thumbnails: [BIG_BASE64] } });

    await runImageMigration();

    expect(mockStore.importFromBase64).toHaveBeenCalledTimes(1);
    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith('e1', ['img:converted0'], ['img:converted0']);
  });

  it('marks a row done even when its image cannot be converted, so it cannot loop forever', async () => {
    givenEntries({ e1: { images: [BIG_BASE64], thumbnails: [] } });
    mockStore.importFromBase64.mockRejectedValue(new Error('corrupt'));

    const progress = await runImageMigration();

    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith('e1', [], []);
    expect(progress.failed).toBeGreaterThan(0);
    expect(progress.finished).toBe(true);
  });

  it('skips the "failed" sentinel written by the old thumbnail migration', async () => {
    givenEntries({ e1: { images: ['failed'], thumbnails: ['failed'] } });

    await runImageMigration();

    expect(mockStore.importFromBase64).not.toHaveBeenCalled();
    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith('e1', [], []);
  });

  it('converts every image on a multi-image entry', async () => {
    givenEntries({ e1: { images: [BIG_BASE64, BIG_BASE64, BIG_BASE64], thumbnails: [] } });

    await runImageMigration();

    expect(mockStore.importFromBase64).toHaveBeenCalledTimes(3);
    expect(mockDb.markEntryMigrated).toHaveBeenCalledWith(
      'e1',
      ['img:converted0', 'img:converted1', 'img:converted2'],
      ['img:converted0', 'img:converted1', 'img:converted2'],
    );
  });

  it('does nothing and reports finished when there is no legacy data', async () => {
    givenEntries({});

    const progress = await runImageMigration();

    expect(mockDb.getRawEntryImages).not.toHaveBeenCalled();
    expect(progress.finished).toBe(true);
    expect(progress.total).toBe(0);
  });

  it('sweeps orphaned files and compacts the database once finished', async () => {
    givenEntries({ e1: { images: [BIG_BASE64], thumbnails: [] } });

    await runImageMigration();

    expect(mockStore.collectGarbage).toHaveBeenCalled();
    expect(mockDb.compactDatabase).toHaveBeenCalled();
  });
});
