import {
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
