/**
 * Copying an entry to the clipboard and pasting it into another activity.
 *
 * The payload is JSON text, because the system clipboard is the only channel
 * that crosses between screens. Images travel as *references*, not data:
 * embedding base64 would make a multi-megabyte clipboard string and
 * reintroduce exactly the memory problem this branch removed. Both entries end
 * up pointing at the same stored blob, which is why deletes are
 * reference-counted (see utils/imageOwnership).
 *
 * A consequence worth knowing: references are local to this device's store, so
 * a payload copied on one device cannot resolve images on another (iCloud
 * Universal Clipboard will happily carry the text across). Paste checks each
 * reference and reports the ones it could not find rather than silently
 * dropping them.
 */
import * as Clipboard from 'expo-clipboard';
import { Tag } from '../data/activity-details';
import * as imageStore from './imageStore';
import { holdRefs } from './clipboardHold';
import { isFileRef } from './imageRef';

/** Marker so we can recognise our own payload and reject unrelated text. */
const PAYLOAD_MARKER = 'lastDoneTracker.entry';
const PAYLOAD_VERSION = 1;

export interface EntryClipboardPayload {
  marker: typeof PAYLOAD_MARKER;
  version: number;
  startDate: string;
  endDate: string;
  notes?: string;
  /** Image references, shared with the source entry. */
  images: string[];
  /** Tags by name and colour — ids are not portable across databases. */
  tags: { name: string; color: string }[];
  /** Informational only, for a friendlier paste confirmation. */
  sourceActivityName?: string;
}

export interface CopyableEntry {
  startDate: Date;
  endDate: Date;
  notes?: string;
  images?: string[];
  tags?: Tag[];
}

export const buildPayload = (
  entry: CopyableEntry,
  sourceActivityName?: string,
): EntryClipboardPayload => ({
  marker: PAYLOAD_MARKER,
  version: PAYLOAD_VERSION,
  startDate: entry.startDate.toISOString(),
  endDate: entry.endDate.toISOString(),
  notes: entry.notes,
  images: (entry.images ?? []).filter(isFileRef),
  tags: (entry.tags ?? []).map(tag => ({ name: tag.name, color: tag.color })),
  sourceActivityName,
});

export const serialisePayload = (payload: EntryClipboardPayload): string =>
  JSON.stringify(payload);

/**
 * Parse clipboard text into a payload.
 * Returns null for anything that is not one of ours — unrelated text on the
 * clipboard must not be mistaken for an entry.
 */
export const parsePayload = (text: string | null | undefined): EntryClipboardPayload | null => {
  if (!text) return null;

  const trimmed = text.trim();
  // Cheap rejection before attempting to parse a potentially large string.
  if (!trimmed.startsWith('{') || !trimmed.includes(PAYLOAD_MARKER)) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || parsed.marker !== PAYLOAD_MARKER) return null;
  if (typeof parsed.version !== 'number' || parsed.version > PAYLOAD_VERSION) return null;

  const startDate = new Date(parsed.startDate);
  const endDate = new Date(parsed.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

  return {
    marker: PAYLOAD_MARKER,
    version: parsed.version,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    images: Array.isArray(parsed.images)
      ? parsed.images.filter((ref: unknown): ref is string => typeof ref === 'string' && isFileRef(ref))
      : [],
    tags: Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((tag: any) => tag && typeof tag.name === 'string')
          .map((tag: any) => ({
            name: tag.name,
            color: typeof tag.color === 'string' ? tag.color : '#34C759',
          }))
      : [],
    sourceActivityName:
      typeof parsed.sourceActivityName === 'string' ? parsed.sourceActivityName : undefined,
  };
};

export const copyEntryToClipboard = async (
  entry: CopyableEntry,
  sourceActivityName?: string,
): Promise<number> => {
  const payload = buildPayload(entry, sourceActivityName);
  await Clipboard.setStringAsync(serialisePayload(payload));

  // Protect the referenced blobs until this copy is superseded or expires.
  // Without it, copying an entry and then deleting it would reclaim the very
  // images the clipboard points at, and the paste would arrive empty.
  await holdRefs(payload.images);

  return payload.images.length;
};

export interface ReadResult {
  payload: EntryClipboardPayload | null;
  /** Set when the clipboard could not be read at all (web permissions). */
  error?: string;
}

export const readEntryFromClipboard = async (): Promise<ReadResult> => {
  try {
    const text = await Clipboard.getStringAsync();
    return { payload: parsePayload(text) };
  } catch (error) {
    // Browsers gate clipboard reads behind a user gesture and permission; a
    // denial here is expected rather than exceptional.
    console.warn('Could not read the clipboard', error);
    return { payload: null, error: 'Clipboard access was blocked by the browser.' };
  }
};

/**
 * Drop references whose blob is not in this device's store.
 * Guards the cross-device case, where the JSON arrives but the images do not.
 */
export const resolveAvailableImages = async (
  refs: string[],
): Promise<{ available: string[]; missing: number }> => {
  const available: string[] = [];
  let missing = 0;

  for (const ref of refs) {
    const uri = await imageStore.resolveImageUri(ref, 'thumb');
    if (uri) {
      available.push(ref);
    } else {
      missing += 1;
    }
  }

  return { available, missing };
};

/**
 * Merge copied tags into the ones already selected.
 * Matching is by name: tag ids are per-database, and a name collision means
 * the user considers them the same tag.
 */
export const mergeTags = (
  existing: Tag[],
  incoming: { name: string; color: string }[],
  resolveTag: (name: string, color: string) => Tag | undefined,
): { merged: Tag[]; missing: { name: string; color: string }[] } => {
  const merged = [...existing];
  const seen = new Set(existing.map(tag => tag.name.toLowerCase()));
  const missing: { name: string; color: string }[] = [];

  for (const candidate of incoming) {
    if (seen.has(candidate.name.toLowerCase())) continue;

    const resolved = resolveTag(candidate.name, candidate.color);
    if (resolved) {
      merged.push(resolved);
      seen.add(candidate.name.toLowerCase());
    } else {
      // Needs creating; the caller does that asynchronously.
      missing.push(candidate);
    }
  }

  return { merged, missing };
};

/** Append copied images to existing ones without duplicating a shared ref. */
export const mergeImageRefs = (existing: string[], incoming: string[]): string[] => {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const ref of incoming) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    merged.push(ref);
  }
  return merged;
};
