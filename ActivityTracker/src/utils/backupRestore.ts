/**
 * Applying CSV rows to the database.
 *
 * Platform-agnostic: `database` and `imageStore` both resolve to the right
 * implementation via Metro's platform extensions, so native and web share this
 * exactly. Split out of backup.ts so backup.web.ts does not duplicate it.
 */
import * as database from './database';
import * as imageStore from './imageStore';
import { generateActivityId } from './crypto';
import { Tag } from '../data/activity-details';
import { classifyImageValue, detectLayout, parseCsvRow } from './csvFormat';
import { makeFileRef, stripDataUri } from './imageRef';
import { ImportResult, ProgressCallback } from './backupTypes';

/**
 * Apply CSV rows to the database.
 * `availableIds` holds image ids that were just restored from the archive.
 */
export const restoreFromCsv = async (
  csvText: string,
  availableIds: Map<string, string>,
  onProgress?: ProgressCallback,
): Promise<ImportResult> => {
  const lines = csvText.split('\n');
  const layout = detectLayout(lines[0]);
  if (!layout) {
    alert('Invalid CSV format: missing required columns (Activity, Date/StartDate).');
    return { entriesImported: 0, imagesImported: 0, imagesMissing: 0 };
  }

  const activities = await database.getActivities();
  const existingTags = await database.getTags();

  let entriesImported = 0;
  let imagesMissing = 0;

  for (let index = 1; index < lines.length; index++) {
    const row = parseCsvRow(lines[index], layout);
    if (!row) continue;

    const activityId = row.activityId || (await generateActivityId(row.activityName));
    const entryId = row.entryId || (await generateActivityId(`${activityId}${row.startDate.getTime()}`));

    // Older exports have no Icon column, so fall back rather than writing
    // undefined over an icon the user already chose.
    const icon = row.icon || 'calendar-check';

    let activity = activities.find(candidate => candidate.id === activityId);
    if (!activity) {
      activity = {
        id: activityId,
        name: row.activityName,
        lastDone: 'Never',
        icon,
        orderIndex: activities.length,
      };
      await database.addActivity(activity);
      activities.push(activity);
    } else if (activity.icon !== icon || activity.name !== row.activityName) {
      activity.icon = icon;
      activity.name = row.activityName;
      await database.updateActivity(activity);
    }

    /* -------- tags -------- */
    const entryTags: Tag[] = [];
    for (const definition of row.tagDefinitions) {
      let tag = existingTags.find(candidate => candidate.name === definition.name);
      if (!tag) {
        tag = {
          id: await generateActivityId(definition.name + Math.random()),
          name: definition.name,
          color: definition.color || '#34C759',
        };
        await database.addTag(tag);
        existingTags.push(tag);
      } else if (definition.color && tag.color !== definition.color) {
        tag.color = definition.color;
        await database.updateTag(tag);
      }
      entryTags.push(tag);
    }

    /* -------- images -------- */
    const refs: string[] = [];
    for (const value of row.imageValues) {
      const classified = classifyImageValue(value);

      if (classified.kind === 'archive') {
        if (availableIds.has(classified.id)) {
          refs.push(makeFileRef(classified.id));
        } else {
          // Filename referenced but no such file in the archive.
          imagesMissing += 1;
        }
      } else if (classified.kind === 'ref') {
        refs.push(classified.ref);
      } else if (classified.kind === 'base64') {
        // Legacy CSV: decode straight into the store, one at a time.
        try {
          const stored = await imageStore.importFromBase64(stripDataUri(value));
          refs.push(stored.ref);
        } catch (error) {
          console.warn('Failed to import inline image', error);
          imagesMissing += 1;
        }
      } else {
        imagesMissing += 1;
      }
    }

    const images = refs.length > 0 ? refs : undefined;
    const existing = await database.getEntryById(entryId);

    if (!existing) {
      await database.addEntry(activityId, {
        id: entryId,
        startDate: row.startDate,
        endDate: row.endDate,
        notes: row.notes,
        images,
        thumbnails: images,
        tags: entryTags,
      });
    } else {
      await database.updateEntry({
        id: existing.id,
        startDate: row.startDate,
        endDate: row.endDate,
        notes: row.notes ?? existing.notes,
        images: images ?? existing.images,
        thumbnails: images ?? existing.thumbnails,
        tags: entryTags,
      });
    }

    entriesImported += 1;
    if (entriesImported % 50 === 0) {
      onProgress?.({ phase: 'restoring', completed: entriesImported, total: lines.length - 1 });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  return { entriesImported, imagesImported: 0, imagesMissing };
};
