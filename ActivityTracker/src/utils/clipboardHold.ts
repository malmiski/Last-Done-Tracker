/**
 * Keeping copied images alive between copy and paste.
 *
 * The problem this solves: copy an entry, delete it, then paste. The clipboard
 * carries image *references*, and the delete path only considers the database
 * when deciding whether a blob is still needed — so the files were reclaimed
 * while the clipboard still pointed at them, and the paste silently arrived
 * with no photos.
 *
 * A clipboard entry is therefore a real reference, not an incidental one. Copy
 * records a "hold" on the referenced blobs, and both the delete path and the
 * garbage collector treat held refs as live.
 *
 * Design notes:
 *  - Persisted (app_meta), so a copy survives the app being closed before the
 *    paste. That is a completely ordinary thing to do.
 *  - Single slot: a new copy replaces the previous hold. Only the most recent
 *    copy is pasteable anyway, since the system clipboard holds one payload.
 *  - Expires, so a copy that is never pasted cannot pin deleted photos on disk
 *    forever. The bound is generous because the cost of expiring too early is
 *    losing a user's images, and the cost of expiring late is a little disk.
 */
import * as database from './database';
import { isFileRef } from './imageRef';

const META_KEY = 'clipboard.imageHold';

/** How long a copy keeps deleted images alive. */
export const HOLD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredHold {
  refs: string[];
  /** Epoch milliseconds when the copy happened. */
  at: number;
}

/** Record a hold on the refs a copy put on the clipboard. Replaces any prior. */
export const holdRefs = async (refs: string[], now = Date.now()): Promise<void> => {
  const managed = [...new Set(refs.filter(isFileRef))];
  if (managed.length === 0) {
    await clearHold();
    return;
  }
  const hold: StoredHold = { refs: managed, at: now };
  await database.setMeta(META_KEY, JSON.stringify(hold));
};

export const clearHold = async (): Promise<void> => {
  await database.setMeta(META_KEY, '');
};

/**
 * Refs currently protected by a copy. Empty once the hold has expired.
 *
 * Never throws: a corrupt or absent value simply means nothing is held, and
 * failing here must not block a delete.
 */
export const getHeldRefs = async (now = Date.now()): Promise<Set<string>> => {
  try {
    const raw = await database.getMeta(META_KEY);
    if (!raw) return new Set();

    const hold = JSON.parse(raw) as StoredHold;
    if (!hold || !Array.isArray(hold.refs) || typeof hold.at !== 'number') return new Set();
    if (now - hold.at > HOLD_TTL_MS) return new Set();

    return new Set(hold.refs.filter(isFileRef));
  } catch {
    return new Set();
  }
};

/** True when the hold exists but has aged out, so callers can tidy it away. */
export const isHoldExpired = async (now = Date.now()): Promise<boolean> => {
  try {
    const raw = await database.getMeta(META_KEY);
    if (!raw) return false;
    const hold = JSON.parse(raw) as StoredHold;
    if (!hold || typeof hold.at !== 'number') return true;
    return now - hold.at > HOLD_TTL_MS;
  } catch {
    return true;
  }
};
