/**
 * Shared ownership of image blobs.
 *
 * Copy/paste lets two entries reference the same stored image, which means a
 * reference is no longer owned by exactly one entry. Deleting blobs eagerly —
 * "this entry is going away, so delete its files" — would destroy photos that
 * another entry is still displaying.
 *
 * Everything therefore goes through `deleteUnreferencedRefs`: it deletes only
 * the blobs that no surviving entry points at. Call it *after* the rows have
 * been removed, so the live set already reflects the deletion.
 *
 * The check is cheap. `getAllImageRefs` reads only the short reference columns
 * (a migrated row holds ~14 bytes per image), never image data.
 */
import * as database from './database';
import * as imageStore from './imageStore';
import { isFileRef } from './imageRef';

/**
 * Delete each candidate blob that nothing references any more.
 * Returns the refs that were actually deleted.
 */
export const deleteUnreferencedRefs = async (candidates: string[]): Promise<string[]> => {
  const managed = candidates.filter(isFileRef);
  if (managed.length === 0) return [];

  // Deduplicate: an entry can list the same ref for both variants.
  const unique = [...new Set(managed)];

  const stillReferenced = await database.getAllImageRefs();
  const orphaned = unique.filter(ref => !stillReferenced.has(ref));

  await Promise.all(orphaned.map(ref => imageStore.deleteRef(ref)));
  return orphaned;
};

/**
 * How many entries reference a given blob. Used to explain sharing in the UI
 * and to keep the paste path honest about what it is doing.
 */
export const countReferencesTo = async (ref: string): Promise<number> => {
  if (!isFileRef(ref)) return 0;
  const entries = await database.getAllEntries();
  return entries.filter(entry =>
    (entry.images ?? []).includes(ref) || (entry.thumbnails ?? []).includes(ref),
  ).length;
};
