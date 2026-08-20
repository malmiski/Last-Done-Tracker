/**
 * Read the leading bytes of a file the user has just picked, before it is
 * imported and re-encoded.
 *
 * Native build. The picker hands back a file:// URI for a copy it has already
 * staged, so this opens it directly and reads a bounded prefix — never the
 * whole photo. A 12MP JPEG is ~4MB; pulling that onto the JS heap to find a
 * 20-byte timestamp is exactly the kind of thing this app is trying to stop
 * doing.
 */
import { File } from 'expo-file-system';
import { HEADER_BYTES } from './jpegSize';

export const readSourceHeader = async (
  uri?: string | null,
  maxBytes: number = HEADER_BYTES,
): Promise<Uint8Array | null> => {
  if (!uri) return null;
  // Asset library references (ph://, content://) are not openable as files.
  // On those platforms the picker supplies parsed EXIF tags instead.
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return null;

  try {
    const file = new File(uri);
    if (!file.exists) return null;

    const handle = file.open();
    try {
      return handle.readBytes(Math.min(maxBytes, file.size ?? maxBytes));
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
};
