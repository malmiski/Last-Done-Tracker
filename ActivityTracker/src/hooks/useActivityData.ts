import { useState, useEffect, useCallback } from 'react';
import { Activity } from '../data/activities';
import { ActivityEntry } from '../data/activity-details';
import { generateActivityId } from '../utils/crypto';
import * as database from '../utils/database';

export const useActivityData = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityDetails, setActivityDetails] = useState<{ [key: string]: ActivityEntry[] }>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await database.initDatabase();
      const storedActivities = await database.getActivities();
      setActivities(storedActivities);

      const allDetails: { [key: string]: ActivityEntry[] } = {};
      for (const activity of storedActivities) {
        const entries = await database.getEntries(activity.id);
        allDetails[activity.id] = entries;
      }
      setActivityDetails(allDetails);
    } catch (e) {
      console.error('Failed to load data.', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addActivity = async (newActivity: Omit<Activity, 'id' | 'lastDone'>) => {
    const newId = await generateActivityId(newActivity.name);
    if (activities.some(a => a.id === newId)) {
      throw new Error('An activity with this name already exists.');
    }

    const activityToAdd: Activity = {
      ...newActivity,
      id: newId,
      lastDone: 'Never',
    };

    await database.addActivity(activityToAdd);
    setActivities(prev => [...prev, activityToAdd]);
    setActivityDetails(prev => ({ ...prev, [newId]: [] }));

    return activityToAdd;
  };

  const updateActivity = async (updatedActivity: Activity) => {
    await database.updateActivity(updatedActivity);
    setActivities(prev => prev.map(a => a.id === updatedActivity.id ? updatedActivity : a));
  };

  const addActivityEntry = async (activityId: string, date: Date, notes?: string, image?: string) => {
    const newEntry: ActivityEntry = {
      id: await generateActivityId(Math.random().toString()),
      date: date,
      notes: notes,
      image: image,
    };

    await database.addEntry(activityId, newEntry);

    setActivityDetails(prev => {
      const updated = { ...prev };
      updated[activityId] = [newEntry, ...(updated[activityId] || [])];
      return updated;
    });

    // Update lastDone for the activity
    const activity = activities.find(a => a.id === activityId);
    if (activity) {
        const updatedActivity = { ...activity, lastDone: date.toISOString() };
        await updateActivity(updatedActivity);
    }

    return newEntry.id;
  };

  const updateActivityEntry = async (activityId: string, entryId: string, newDate: Date, notes?: string, image?: string) => {
    const entry: ActivityEntry = {
        id: entryId,
        date: newDate,
        notes: notes,
        image: image,
    };
    await database.updateEntry(entry);

    setActivityDetails(prev => {
      const updated = { ...prev };
      const entryIndex = updated[activityId].findIndex(e => e.id === entryId);
      if (entryIndex > -1) {
        updated[activityId][entryIndex] = entry;
      }
      return updated;
    });
  };

  const deleteActivityEntry = async (activityId: string, entryId: string) => {
    await database.deleteEntry(entryId);
    setActivityDetails(prev => {
      const updated = { ...prev };
      updated[activityId] = updated[activityId].filter(entry => entry.id !== entryId);
      return updated;
    });
  };

  const deleteActivity = async (activityId: string) => {
    await database.deleteActivity(activityId);
    setActivities(prev => prev.filter(a => a.id !== activityId));
    setActivityDetails(prev => {
      const updated = { ...prev };
      delete updated[activityId];
      return updated;
    });
  };

  const getActivityById = useCallback((activityId: string) => {
    return activities.find(a => a.id === activityId);
  }, [activities]);

  return {
    activities,
    activityDetails,
    loading,
    addActivity,
    updateActivity,
    addActivityEntry,
    updateActivityEntry,
    deleteActivityEntry,
    deleteActivity,
    getActivityById,
    refreshData: loadData,
  };
};
