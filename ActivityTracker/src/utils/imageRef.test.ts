import {
  base64ToBytes,
  bytesToBase64,
  isFileRef,
  isInlineBase64,
  isLegacyPlaceholder,
  isRenderable,
  makeFileRef,
  makeLegacyPlaceholder,
  parseRefArray,
  refId,
  serialiseRefArray,
  stripDataUri,
  toDataUri,
} from './imageRef';

/**
 * These are the rules that keep legacy data readable during the migration, so
 * they are worth pinning: a mistake here means either base64 leaking back into
 * a list query or an existing photo silently failing to render.
 */
describe('image reference classification', () => {
  it('recognises managed references', () => {
    expect(isFileRef('img:abc123')).toBe(true);
    expect(isFileRef('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(refId('img:abc123')).toBe('abc123');
    expect(makeFileRef('abc123')).toBe('img:abc123');
  });

  it('treats data URIs and long strings as inline base64', () => {
    expect(isInlineBase64('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isInlineBase64('A'.repeat(5000))).toBe(true);
    // A short opaque string is a reference, not a truncated image.
    expect(isInlineBase64('img:abc123')).toBe(false);
    expect(isInlineBase64('failed')).toBe(false);
    expect(isInlineBase64('')).toBe(false);
  });

  it('never treats sentinels or placeholders as renderable', () => {
    expect(isRenderable('failed')).toBe(false);
    expect(isRenderable(makeLegacyPlaceholder('entry-1'))).toBe(false);
    expect(isRenderable('img:abc')).toBe(true);
    expect(isRenderable(undefined)).toBe(false);
    expect(isLegacyPlaceholder('legacy:entry-1')).toBe(true);
  });

  it('normalises data URIs in both directions', () => {
    expect(toDataUri('AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(toDataUri('data:image/png;base64,BBBB')).toBe('data:image/png;base64,BBBB');
    expect(stripDataUri('data:image/png;base64,BBBB')).toBe('BBBB');
    expect(stripDataUri('BBBB')).toBe('BBBB');
  });
});

describe('persisted column parsing', () => {
  it('reads JSON arrays of references', () => {
    expect(parseRefArray('["img:a","img:b"]')).toEqual(['img:a', 'img:b']);
  });

  it('treats a bare value as a single-element array', () => {
    expect(parseRefArray('img:a')).toEqual(['img:a']);
    expect(parseRefArray('data:image/jpeg;base64,AAAA')).toEqual(['data:image/jpeg;base64,AAAA']);
  });

  it('handles empty and malformed values without throwing', () => {
    expect(parseRefArray(null)).toBeUndefined();
    expect(parseRefArray('')).toBeUndefined();
    expect(parseRefArray(undefined)).toBeUndefined();
    // Malformed JSON falls back to treating the whole value as one entry.
    expect(parseRefArray('[not json')).toEqual(['[not json']);
  });

  it('round-trips through serialisation', () => {
    const refs = ['img:a', 'img:b'];
    expect(parseRefArray(serialiseRefArray(refs))).toEqual(refs);
    expect(serialiseRefArray([])).toBeNull();
    expect(serialiseRefArray(undefined)).toBeNull();
  });
});

/**
 * These replaced expo-file-system's `write(content, { encoding: 'base64' })`,
 * whose native module rejects the options argument in 19.0.17. Every migrated
 * image now passes through this decoder, so correctness here is not optional:
 * a bug corrupts photos rather than merely failing loudly.
 */
describe('base64 codec', () => {
  const roundTrip = (bytes: number[]) =>
    Array.from(base64ToBytes(bytesToBase64(new Uint8Array(bytes))));

  it('round-trips every byte value', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(roundTrip(all)).toEqual(all);
  });

  it('handles each padding case', () => {
    // Lengths mod 3 of 0, 1 and 2 produce '', '==' and '=' padding.
    expect(roundTrip([1, 2, 3])).toEqual([1, 2, 3]);
    expect(roundTrip([1])).toEqual([1]);
    expect(roundTrip([1, 2])).toEqual([1, 2]);
    expect(bytesToBase64(new Uint8Array([1]))).toMatch(/==$/);
    expect(bytesToBase64(new Uint8Array([1, 2]))).toMatch(/[^=]=$/);
  });

  it('matches known vectors', () => {
    const encode = (text: string) =>
      bytesToBase64(new Uint8Array([...text].map(c => c.charCodeAt(0))));
    expect(encode('Man')).toBe('TWFu');
    expect(encode('Ma')).toBe('TWE=');
    expect(encode('M')).toBe('TQ==');
    expect(encode('hello world')).toBe('aGVsbG8gd29ybGQ=');
  });

  it('decodes a real JPEG header', () => {
    // FF D8 FF E0 is the SOI + APP0 marker every JPEG starts with.
    const bytes = base64ToBytes('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==');
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('strips a data URI prefix before decoding', () => {
    expect(Array.from(base64ToBytes('data:image/jpeg;base64,TWFu'))).toEqual(
      Array.from(base64ToBytes('TWFu')),
    );
  });

  it('tolerates whitespace, newlines and missing padding', () => {
    const expected = Array.from(base64ToBytes('aGVsbG8gd29ybGQ='));
    expect(Array.from(base64ToBytes('aGVsbG8g\nd29ybGQ='))).toEqual(expected);
    expect(Array.from(base64ToBytes('aGVsbG8gd29ybGQ'))).toEqual(expected);
  });

  it('returns an empty array for empty input rather than throwing', () => {
    expect(base64ToBytes('').length).toBe(0);
    expect(base64ToBytes('data:image/jpeg;base64,').length).toBe(0);
  });

  it('produces byte-exact output for a large payload', () => {
    // Guards against drift in the accumulator across many 3-byte groups.
    const original = Array.from({ length: 5000 }, (_, i) => (i * 37) % 256);
    expect(roundTrip(original)).toEqual(original);
  });
});
