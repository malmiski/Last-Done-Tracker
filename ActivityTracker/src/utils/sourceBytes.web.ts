/**
 * Read the leading bytes of a file the user has just picked, before it is
 * imported and re-encoded.
 *
 * Web build. The picker gives us a blob: or data: URL, so the bytes come back
 * through fetch. Only a prefix is materialised: `Blob.slice` is a view, so the
 * ArrayBuffer that reaches the heap is the header and nothing more.
 */
import { HEADER_BYTES } from './jpegSize';

export const readSourceHeader = async (
  uri?: string | null,
  maxBytes: number = HEADER_BYTES,
): Promise<Uint8Array | null> => {
  if (!uri) return null;

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const header = blob.slice(0, Math.min(maxBytes, blob.size));
    return new Uint8Array(await header.arrayBuffer());
  } catch {
    // A revoked object URL or a cross-origin source: no metadata, no prompt.
    return null;
  }
};
