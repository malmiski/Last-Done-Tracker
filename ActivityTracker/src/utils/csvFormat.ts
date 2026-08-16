/**
 * CSV row shaping and parsing, shared by the native and web backup code.
 *
 * The column layout is unchanged from previous versions so old exports still
 * import. What changed is the *content* of the Image and Thumbnail columns:
 * they now hold image filenames (`a3f9c1.jpg`) that refer to entries in the
 * archive's `images/` folder, rather than megabytes of inline base64.
 *
 * Import still accepts inline base64 in those columns, so every CSV the app
 * has ever produced remains readable.
 */
import { Tag } from '../data/activity-details';
import { isFileRef, isInlineBase64, refId } from './imageRef';

export const CSV_HEADER =
  'ActivityID,Activity,Icon,EntryID,StartDate,EndDate,Notes,Image,Thumbnail,Tags';

export const IMAGES_FOLDER = 'images';
export const CSV_FILENAME = 'data.csv';
export const DB_FILENAME = 'activities.db';

/** Archive path for a managed reference. Ids are stable across export/import. */
export const archiveNameFor = (ref: string, variant: 'full' | 'thumb'): string | null => {
  if (!isFileRef(ref)) return null;
  const id = refId(ref);
  return variant === 'thumb' ? `${id}_thumb.jpg` : `${id}.jpg`;
};

/**
 * Recover the reference an archive filename belongs to.
 * Because images are stored under their own id, an imported file can be written
 * back with the same id and every `img:<id>` in the CSV resolves without any
 * remapping table.
 */
export const parseArchiveName = (
  name: string,
): { id: string; variant: 'full' | 'thumb' } | null => {
  const base = name.split('/').pop();
  if (!base || !base.endsWith('.jpg')) return null;
  if (base.endsWith('_thumb.jpg')) {
    return { id: base.slice(0, -'_thumb.jpg'.length), variant: 'thumb' };
  }
  return { id: base.slice(0, -'.jpg'.length), variant: 'full' };
};

export const escapeCsv = (field: unknown): string => {
  if (field === undefined || field === null) return '';
  const value = String(field).replace(/\r?\n/g, ' ');
  if (value.includes(',') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

export interface CsvRowInput {
  activityId: string;
  activityName: string;
  icon?: string;
  entryId: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  imageRefs?: string[];
  tags?: Tag[];
  /** When false, unmanaged (legacy inline) values are written through as-is. */
  useArchiveNames?: boolean;
}

export const buildCsvRow = ({
  activityId,
  activityName,
  icon,
  entryId,
  startDate,
  endDate,
  notes,
  imageRefs = [],
  tags = [],
  useArchiveNames = true,
}: CsvRowInput): string => {
  const toColumn = (variant: 'full' | 'thumb') =>
    imageRefs
      .map(ref => {
        if (useArchiveNames) {
          const name = archiveNameFor(ref, variant);
          if (name) return name;
        }
        // Legacy inline base64 or an unmigrated placeholder: pass through so
        // the export is never silently lossy.
        return ref;
      })
      .join('|');

  return [
    activityId,
    activityName,
    icon,
    entryId,
    startDate.toISOString(),
    endDate.toISOString(),
    notes || '',
    toColumn('full'),
    toColumn('thumb'),
    tags.map(tag => `${tag.name}:${tag.color}`).join('|'),
  ]
    .map(escapeCsv)
    .join(',');
};

export interface ParsedCsvRow {
  activityId?: string;
  activityName: string;
  icon?: string;
  entryId?: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  /** Raw values: archive filenames, `img:` refs, or inline base64. */
  imageValues: string[];
  tagDefinitions: { name: string; color?: string }[];
}

export interface CsvLayout {
  hasIds: boolean;
  hasEndDate: boolean;
  hasTags: boolean;
  hasThumbnail: boolean;
}

export const detectLayout = (headerLine: string): CsvLayout | null => {
  const header = parseCsvLine(headerLine);
  if (!header.includes('Activity') || (!header.includes('Date') && !header.includes('StartDate'))) {
    return null;
  }
  return {
    hasIds: header.includes('ActivityID') && header.includes('EntryID'),
    hasEndDate: header.includes('EndDate'),
    hasTags: header.includes('Tags'),
    hasThumbnail: header.includes('Thumbnail'),
  };
};

/**
 * Parse one data line against a detected layout.
 * Returns null for lines that cannot be interpreted, which the caller skips.
 */
export const parseCsvRow = (line: string, layout: CsvLayout): ParsedCsvRow | null => {
  if (!line || line.trim() === '') return null;
  const values = parseCsvLine(line);

  let activityId: string | undefined;
  let activityName: string | undefined;
  let icon: string | undefined;
  let entryId: string | undefined;
  let startDateString: string | undefined;
  let endDateString: string | undefined;
  let notes: string | undefined;
  let imagesString: string | undefined;

  if (layout.hasIds) {
    if (layout.hasEndDate) {
      if (layout.hasTags && layout.hasThumbnail) {
        if (values.length < 10) return null;
        [activityId, activityName, icon, entryId, startDateString, endDateString, notes, imagesString] = values;
      } else if (layout.hasTags) {
        if (values.length < 9) return null;
        [activityId, activityName, icon, entryId, startDateString, endDateString, notes, imagesString] = values;
      } else {
        if (values.length < 8) return null;
        [activityId, activityName, icon, entryId, startDateString, endDateString, notes, imagesString] = values;
      }
    } else {
      if (values.length < 7) return null;
      [activityId, activityName, icon, entryId, startDateString, notes, imagesString] = values;
      endDateString = startDateString;
    }
  } else if (layout.hasEndDate) {
    if (values.length < 6) return null;
    [activityName, icon, startDateString, endDateString, notes, imagesString] = values;
  } else {
    if (values.length < 5) return null;
    [activityName, icon, startDateString, notes, imagesString] = values;
    endDateString = startDateString;
  }

  if (!activityName || !startDateString) return null;

  const tagsString = layout.hasTags ? values[values.length - 1] : '';
  const tagDefinitions = (tagsString || '')
    .split('|')
    .filter(Boolean)
    .map(definition => {
      const [name, color] = definition.split(':');
      return { name, color };
    })
    .filter(tag => Boolean(tag.name));

  return {
    activityId,
    activityName,
    icon,
    entryId,
    startDate: new Date(startDateString),
    endDate: new Date(endDateString || startDateString),
    notes: notes || undefined,
    imageValues: (imagesString || '').split('|').filter(Boolean),
    tagDefinitions,
  };
};

/**
 * Classify a value found in the Image column.
 *  - `archive`  : a filename inside the zip's images/ folder
 *  - `ref`      : an `img:<id>` reference that is already in the store
 *  - `base64`   : legacy inline data that must be imported
 *  - `unknown`  : anything else (skipped, reported)
 */
export const classifyImageValue = (
  value: string,
): { kind: 'archive'; id: string } | { kind: 'ref'; ref: string } | { kind: 'base64' } | { kind: 'unknown' } => {
  if (isFileRef(value)) return { kind: 'ref', ref: value };
  if (isInlineBase64(value)) return { kind: 'base64' };
  const parsed = parseArchiveName(value);
  if (parsed) return { kind: 'archive', id: parsed.id };
  return { kind: 'unknown' };
};
