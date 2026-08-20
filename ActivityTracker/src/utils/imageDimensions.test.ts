const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('./database', () => ({
  getImageDimensions: (refs: string[]) => mockGet(refs),
  putImageDimensions: (records: any[]) => mockPut(records),
}));

import {
  knownDimensions,
  loadDimensionsFor,
  rememberDimensions,
  resetDimensionCache,
  subscribeToDimensions,
} from './imageDimensions';

beforeEach(() => {
  resetDimensionCache();
  mockGet.mockReset().mockResolvedValue({});
  mockPut.mockReset().mockResolvedValue(undefined);
});

describe('imageDimensions', () => {
  it('reads sizes synchronously once they have been loaded', async () => {
    // Synchronous is the whole point: the list needs a row's height before it
    // renders it, and an await means painting at the wrong height first.
    expect(knownDimensions('img:1')).toBeNull();

    mockGet.mockResolvedValue({ 'img:1': { width: 100, height: 200 } });
    await loadDimensionsFor(['img:1']);

    expect(knownDimensions('img:1')).toEqual({ width: 100, height: 200 });
  });

  it('asks the database once per reference, hit or miss', async () => {
    mockGet.mockResolvedValue({ 'img:1': { width: 10, height: 20 } });
    await loadDimensionsFor(['img:1', 'img:2']);
    expect(mockGet).toHaveBeenCalledWith(['img:1', 'img:2']);

    // img:2 was not found, but asking again would repeat the query on every
    // page load for every image that has never been measured.
    await loadDimensionsFor(['img:1', 'img:2']);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('allows a retry when the lookup itself failed', async () => {
    mockGet.mockRejectedValueOnce(new Error('closed'));
    await loadDimensionsFor(['img:1']);

    mockGet.mockResolvedValue({ 'img:1': { width: 10, height: 20 } });
    await loadDimensionsFor(['img:1']);

    expect(knownDimensions('img:1')).toEqual({ width: 10, height: 20 });
  });

  it('notifies subscribers when something new is learned', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToDimensions(listener);

    mockGet.mockResolvedValue({ 'img:1': { width: 10, height: 20 } });
    await loadDimensionsFor(['img:1']);
    expect(listener).toHaveBeenCalledTimes(1);

    // Nothing new: a row that is already placed must not be rebuilt.
    mockGet.mockResolvedValue({});
    await loadDimensionsFor(['img:2']);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    rememberDimensions('img:3', { width: 1, height: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caches and persists a size measured elsewhere', () => {
    rememberDimensions('img:1', { width: 640, height: 480 });

    expect(knownDimensions('img:1')).toEqual({ width: 640, height: 480 });
    expect(mockPut).toHaveBeenCalledWith([{ ref: 'img:1', width: 640, height: 480 }]);
  });

  it('does not write the same size twice', () => {
    rememberDimensions('img:1', { width: 640, height: 480 });
    rememberDimensions('img:1', { width: 640, height: 480 });
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('ignores sizes that cannot be real', () => {
    rememberDimensions('img:1', { width: 0, height: 480 });
    rememberDimensions('img:2', { width: 640, height: -1 });

    expect(knownDimensions('img:1')).toBeNull();
    expect(knownDimensions('img:2')).toBeNull();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('treats a remembered size as already looked up', async () => {
    rememberDimensions('img:1', { width: 10, height: 20 });
    await loadDimensionsFor(['img:1']);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
