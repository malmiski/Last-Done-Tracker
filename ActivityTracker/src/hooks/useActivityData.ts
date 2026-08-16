/**
 * Activity-level state.
 *
 * What changed and why: this hook used to load *every entry of every activity*
 * into a single React state object on mount — including the base64 image data
 * on each row. Because every screen calls the hook, opening the editor for one
 * entry re-read the entire database. That single behaviour accounted for most
 * of the ~900MB baseline.
 *
 * It now holds only what the activity list actually renders: the activities,
 * the tags, and the single most recent entry per activity. Entry lists come
 * from `useEntries`, and the editor loads its one row through `useEntry`.
 *
 * State lives in a module-level store so that four mounted screens share one
 * copy and one load, rather than each keeping its own.
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity } from '../data/activities';
import { ActivityEntry, Tag } from '../data/activity-details';
import { generateActivityId } from '../utils/crypto';
import * as database from '../utils/database';
import * as imageStore from '../utils/imageStore';
import { deleteUnreferencedRefs } from '../utils/imageOwnership';
import { clearHold } from '../utils/clipboardHold';

type LatestEntries = Record<string, ActivityEntry & { activityId: string }>;

interface ActivityStoreState {
  activities: Activity[];
  tags: Tag[];
  latestEntries: LatestEntries;
  loading: boolean;
}

let state: ActivityStoreState = {
  activities: [],
  tags: [],
  latestEntries: {},
  loading: true,
};

const subscribers = new Set<(next: ActivityStoreState) => void>();
let inFlight: Promise<void> | null = null;

const setState = (patch: Partial<ActivityStoreState>) => {
  state = { ...state, ...patch };
  subscribers.forEach(notify => notify(state));
};

/** Load activity-level data. Concurrent callers share one round trip. */
const load = (): Promise<void> => {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await database.initDatabase();
      const [activities, tags, latestEntries] = await Promise.all([
        database.getActivities(),
        database.getTags(),
        database.getLatestEntryPerActivity(),
      ]);
      setState({ activities, tags, latestEntries, loading: false });
    } catch (error) {
      console.error('Failed to load data.', error);
      setState({ loading: false });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};

/** Refresh just one activity's cached "latest entry" tile. */
const refreshLatestEntry = async (activityId: string) => {
  const latest = await database.getLatestEntry(activityId);
  const latestEntries = { ...state.latestEntries };
  if (latest) {
    latestEntries[activityId] = latest;
  } else {
    delete latestEntries[activityId];
  }
  setState({ latestEntries });
};

export const useActivityData = () => {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    subscribers.add(setSnapshot);
    // Sync up with any load that completed between render and effect.
    setSnapshot(state);
    if (state.loading && !inFlight) void load();
    return () => {
      subscribers.delete(setSnapshot);
    };
  }, []);

  const refreshData = useCallback(() => load(), []);

  const addActivity = useCallback(async (newActivity: Omit<Activity, 'id' | 'lastDone'>) => {
    const newId = await generateActivityId(newActivity.name);
    if (state.activities.some(a => a.id === newId)) {
      throw new Error('An activity with this name already exists.');
    }

    const maxOrderIndex = state.activities.reduce((max, a) => Math.max(max, a.orderIndex ?? 0), -1);
    const activityToAdd: Activity = {
      ...newActivity,
      id: newId,
      lastDone: 'Never',
      orderIndex: maxOrderIndex + 1,
    };

    await database.addActivity(activityToAdd);
    setState({ activities: [...state.activities, activityToAdd] });
    return activityToAdd;
  }, []);

  const updateActivity = useCallback(async (updatedActivity: Activity) => {
    await database.updateActivity(updatedActivity);
    setState({
      activities: state.activities
        .map(a => (a.id === updatedActivity.id ? updatedActivity : a))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    });
  }, []);

  const reorderActivities = useCallback(async (newActivities: Activity[]) => {
    setState({ activities: newActivities });
    await database.updateActivitiesOrder(newActivities);
  }, []);

  const addActivityEntry = useCallback(async (
    activityId: string,
    startDate: Date,
    endDate: Date,
    notes?: string,
    images?: string[],
    thumbnails?: string[],
    entryTags?: Tag[],
  ) => {
    const newEntry: ActivityEntry = {
      id: await generateActivityId(activityId + startDate.getTime().toString()),
      startDate,
      endDate,
      notes,
      images,
      thumbnails,
      tags: entryTags,
    };

    await database.addEntry(activityId, newEntry);

    const activity = state.activities.find(a => a.id === activityId);
    if (activity) {
      await database.updateActivity({ ...activity, lastDone: startDate.toISOString() });
      setState({
        activities: state.activities.map(a =>
          a.id === activityId ? { ...a, lastDone: startDate.toISOString() } : a,
        ),
      });
    }
    await refreshLatestEntry(activityId);

    return newEntry.id;
  }, []);

  const updateActivityEntry = useCallback(async (
    activityId: string,
    entryId: string,
    startDate: Date,
    endDate: Date,
    notes?: string,
    images?: string[],
    thumbnails?: string[],
    entryTags?: Tag[],
  ) => {
    // NOTE: the previous implementation assigned an undefined `entry` variable
    // here, so in-memory state silently became a hole after every edit.
    const updatedEntry: ActivityEntry = {
      id: entryId,
      startDate,
      endDate,
      notes,
      images,
      thumbnails,
      tags: entryTags,
    };
    await database.updateEntry(updatedEntry);
    await refreshLatestEntry(activityId);
    return updatedEntry;
  }, []);

  const deleteActivityEntry = useCallback(async (activityId: string, entryId: string) => {
    // Read the references *before* the row disappears, then delete the blobs.
    // SQLite's ON DELETE CASCADE cannot reach the filesystem, so without this
    // the photos would survive the entry that owned them.
    //
    // Deletion is reference-counted rather than eager: copy/paste lets two
    // entries share one stored image, so a blob is only removed once no
    // surviving entry points at it. Runs after the row is gone, so the live
    // set already excludes this entry.
    const refs = await database.getImageRefsForEntry(entryId);
    await database.deleteEntry(entryId);
    await deleteUnreferencedRefs(refs);
    await refreshLatestEntry(activityId);
  }, []);

  const deleteActivity = useCallback(async (activityId: string) => {
    // Same cascade, one level up: gather every photo belonging to every entry
    // of this activity before the rows are removed. Still reference-counted —
    // an entry in another activity may share one of these images.
    const refs = await database.getImageRefsForActivity(activityId);
    await database.deleteActivity(activityId);
    await deleteUnreferencedRefs(refs);

    const latestEntries = { ...state.latestEntries };
    delete latestEntries[activityId];
    setState({
      activities: state.activities.filter(a => a.id !== activityId),
      latestEntries,
    });
  }, []);

  /** Delete every entry across all activities, and every photo with them. */
  const clearAllHistory = useCallback(async () => {
    await database.deleteAllEntries();
    // "Delete everything" is explicit intent, so a pending clipboard copy is
    // released too rather than keeping deleted photos on disk.
    await clearHold();
    // Nothing references any blob now, so a sweep removes all of them.
    await imageStore.collectGarbage(new Set());
    setState({
      activities: state.activities.map(a => ({ ...a, lastDone: 'Never' })),
      latestEntries: {},
    });
  }, []);

  const getActivityById = useCallback(
    (activityId: string) => snapshot.activities.find(a => a.id === activityId),
    [snapshot.activities],
  );

  const addTag = useCallback(async (name: string, color: string) => {
    const newTag: Tag = { id: await generateActivityId(name + Math.random()), name, color };
    await database.addTag(newTag);
    setState({ tags: [...state.tags, newTag].sort((a, b) => a.name.localeCompare(b.name)) });
    return newTag;
  }, []);

  const updateTag = useCallback(async (tag: Tag) => {
    await database.updateTag(tag);
    setState({
      tags: state.tags.map(t => (t.id === tag.id ? tag : t)).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }, []);

  const deleteTag = useCallback(async (tagId: string) => {
    await database.deleteTag(tagId);
    setState({ tags: state.tags.filter(t => t.id !== tagId) });
  }, []);

  return {
    activities: snapshot.activities,
    tags: snapshot.tags,
    /** Most recent entry per activity — what the activity list tiles render. */
    latestEntries: snapshot.latestEntries,
    loading: snapshot.loading,
    addActivity,
    updateActivity,
    addActivityEntry,
    updateActivityEntry,
    deleteActivityEntry,
    deleteActivity,
    clearAllHistory,
    getActivityById,
    addTag,
    updateTag,
    deleteTag,
    reorderActivities,
    refreshData,
  };
};

/** Exposed so screens can nudge a single tile without a full reload. */
export const refreshActivityLatestEntry = refreshLatestEntry;
