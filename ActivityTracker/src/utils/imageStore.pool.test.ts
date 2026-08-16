/**
 * Regression tests for the object-URL pool in imageStore.web.
 *
 * The bug these exist to prevent: revoking an object URL that a mounted <img>
 * is still pointing at breaks that element permanently. The browser does not
 * retry, and React does not re-resolve because the ref and variant it depends
 * on have not changed.
 *
 * Observed as: switching the entry list from small to medium thumbnails left
 * the already-rendered tiles broken with "image not found", while tiles
 * scrolled into view afterwards loaded fine. Both sizes use the 'thumb'
 * variant, so nothing re-resolved. Large mode was unaffected because it uses
 * the 'full' variant, which *did* change and therefore did re-resolve.
 */

// `global` is not in the DOM/esnext lib set this project type-checks against.
declare const global: any;

const revoked: string[] = [];
let created = 0;

const blobs = new Map<string, { size: number }>();

beforeEach(() => {
  revoked.length = 0;
  created = 0;
  blobs.clear();
  jest.resetModules();
});

/** Minimal IndexedDB + URL stand-ins: enough to exercise the pool logic. */
const installGlobals = () => {
  (global as any).URL = {
    createObjectURL: () => `blob:mock/${++created}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  };

  const store = {
    get: (key: string) => request(blobs.get(key) ?? null),
    put: (value: any, key: string) => {
      blobs.set(key, value);
      return request(undefined);
    },
    delete: (key: string) => {
      blobs.delete(key);
      return request(undefined);
    },
    getAll: () => request([...blobs.values()]),
    getAllKeys: () => request([...blobs.keys()]),
  };

  const request = (result: any) => {
    const req: any = { result };
    setTimeout(() => req.onsuccess?.({ target: req }), 0);
    return req;
  };

  const transaction = () => {
    const tx: any = { objectStore: () => store };
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  };

  (global as any).indexedDB = {
    open: () => {
      const req: any = {};
      setTimeout(() => {
        req.result = { objectStoreNames: { contains: () => true }, transaction };
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };
};

const loadStore = async () => {
  installGlobals();
  const store = require('./imageStore.web');
  // Seed two variants for one image.
  await store.writeFromBytes(new Uint8Array([1, 2, 3]), 'full', 'abc');
  await store.writeFromBytes(new Uint8Array([4, 5, 6]), 'thumb', 'abc');
  revoked.length = 0; // ignore invalidations from seeding
  return store;
};

describe('object URL pool', () => {
  it('does not revoke a URL that is still retained', async () => {
    const store = await loadStore();

    const held = await store.acquireImageUri('img:abc', 'thumb');
    expect(held).not.toBeNull();

    // This is what switching small -> medium used to do.
    store.clearMemoryCache();

    expect(revoked).not.toContain(held!.uri);
  });

  it('revokes once the last holder releases', async () => {
    const store = await loadStore();

    const held = await store.acquireImageUri('img:abc', 'thumb');
    store.releaseImageUri(held!.key);
    store.clearMemoryCache();

    expect(revoked).toContain(held!.uri);
  });

  it('keeps the URL alive while any holder remains', async () => {
    const store = await loadStore();

    const first = await store.acquireImageUri('img:abc', 'thumb');
    const second = await store.acquireImageUri('img:abc', 'thumb');
    // Two components, same image — the pool hands out one URL.
    expect(second!.uri).toBe(first!.uri);

    store.releaseImageUri(first!.key);
    store.clearMemoryCache();
    expect(revoked).not.toContain(first!.uri);

    store.releaseImageUri(second!.key);
    store.clearMemoryCache();
    expect(revoked).toContain(first!.uri);
  });

  it('survives the small -> medium transition that originally broke', async () => {
    const store = await loadStore();

    // Small tiles mount and resolve.
    const small = await store.acquireImageUri('img:abc', 'thumb');

    // Mode switch fires clearImageMemoryCache while those tiles are mounted.
    store.clearMemoryCache();

    // Medium tiles use the same variant, so React does not re-resolve; the
    // component keeps displaying the URL it already has. It must still work.
    expect(revoked).not.toContain(small!.uri);

    // And a fresh acquire returns the same, still-valid URL.
    const medium = await store.acquireImageUri('img:abc', 'thumb');
    expect(medium!.uri).toBe(small!.uri);
  });

  it('bumps the epoch when a blob is replaced so components re-resolve', async () => {
    const store = await loadStore();

    const before = store.getCacheEpoch();
    const held = await store.acquireImageUri('img:abc', 'thumb');

    // Re-importing over the same id replaces the blob. An object URL pins the
    // old Blob, so the cached URL must be invalidated or the stale image shows.
    await store.writeFromBytes(new Uint8Array([9, 9, 9]), 'thumb', 'abc');

    expect(store.getCacheEpoch()).toBeGreaterThan(before);
    expect(revoked).toContain(held!.uri);

    const after = await store.acquireImageUri('img:abc', 'thumb');
    expect(after!.uri).not.toBe(held!.uri);
  });

  it('notifies subscribers on invalidation', async () => {
    const store = await loadStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribeToCacheEpoch(listener);

    const held = await store.acquireImageUri('img:abc', 'thumb');
    store.releaseImageUri(held!.key);
    store.clearMemoryCache();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('falls back to the full image when a thumbnail is missing', async () => {
    installGlobals();
    const store = require('./imageStore.web');
    // Only the full variant exists — this is what a partially imported or
    // pre-thumbnail entry looks like.
    await store.writeFromBytes(new Uint8Array([1, 2, 3]), 'full', 'xyz');

    const resolved = await store.acquireImageUri('img:xyz', 'thumb');
    expect(resolved).not.toBeNull();
    expect(resolved!.uri).toMatch(/^blob:mock\//);
  });

  it('returns null for a reference with no stored blob at all', async () => {
    installGlobals();
    const store = require('./imageStore.web');
    expect(await store.acquireImageUri('img:nothing', 'thumb')).toBeNull();
  });

  it('passes inline base64 through unpooled', async () => {
    const store = await loadStore();
    const resolved = await store.acquireImageUri('data:image/jpeg;base64,AAAA', 'thumb');
    expect(resolved).toEqual({ uri: 'data:image/jpeg;base64,AAAA', key: null });
    // No pool key means releasing is a no-op rather than an error.
    expect(() => store.releaseImageUri(null)).not.toThrow();
  });
});
