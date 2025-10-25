import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activities as initialActivities, Activity } from '../data/activities';
import { activityDetails as initialActivityDetails, ActivityEntry } from '../data/activity-details';
import { generateActivityId } from '../utils/crypto';

const ACTIVITIES_KEY = '@activities';
const ACTIVITY_DETAILS_KEY = '@activityDetails';

export const useActivityData = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityDetails, setActivityDetails] = useState<{ [key: string]: ActivityEntry[] }>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const storedActivities = await AsyncStorage.getItem(ACTIVITIES_KEY);
      const storedActivityDetails = await AsyncStorage.getItem(ACTIVITY_DETAILS_KEY);

      if (storedActivities !== null) {
        setActivities(JSON.parse(storedActivities));
      } else {
        setActivities(initialActivities);
        await AsyncStorage.setItem(ACTIVITIES_KEY, JSON.stringify(initialActivities));
      }

      if (storedActivityDetails !== null) {
        const parsedDetails = JSON.parse(storedActivityDetails, (key, value) => {
          if (key === 'date') return new Date(value);
          return value;
        });
        setActivityDetails(parsedDetails);
      } else {
        setActivityDetails(initialActivityDetails);
        await AsyncStorage.setItem(ACTIVITY_DETAILS_KEY, JSON.stringify(initialActivityDetails));
      }
    } catch (e) {
      console.error('Failed to load data.', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveData = async (key: string, data: any) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save data.', e);
    }
  };

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
    const updatedActivities = [...activities, activityToAdd];
    setActivities(updatedActivities);
    await saveData(ACTIVITIES_KEY, updatedActivities);

    const updatedDetails = { ...activityDetails, [newId]: [] };
    setActivityDetails(updatedDetails);
    await saveData(ACTIVITY_DETAILS_KEY, updatedDetails);
    return activityToAdd;
  };

  const updateActivity = async (updatedActivity: Activity) => {
    const updatedActivities = activities.map(a =>
      a.id === updatedActivity.id ? updatedActivity : a
    );
    setActivities(updatedActivities);
    await saveData(ACTIVITIES_KEY, updatedActivities);
  };

  const addActivityEntry = async (activityId: string, date: Date) => {
    const newEntry: ActivityEntry = {
      id: await generateActivityId(Math.random().toString()),
      date: date,
    };
    const updatedDetails = { ...activityDetails };
    updatedDetails[activityId] = [newEntry, ...(updatedDetails[activityId] || [])];
    setActivityDetails(updatedDetails);
    await saveData(ACTIVITY_DETAILS_KEY, updatedDetails);
  };

  const updateActivityEntry = async (activityId: string, entryId: string, newDate: Date) => {
    const updatedDetails = { ...activityDetails };
    const entryIndex = updatedDetails[activityId].findIndex(entry => entry.id === entryId);
    if (entryIndex > -1) {
      updatedDetails[activityId][entryIndex].date = newDate;
      setActivityDetails(updatedDetails);
      await saveData(ACTIVITY_DETAILS_KEY, updatedDetails);
    }
  };

  const deleteActivityEntry = async (activityId: string, entryId: string) => {
    const updatedDetails = { ...activityDetails };
    updatedDetails[activityId] = updatedDetails[activityId].filter(entry => entry.id !== entryId);
    setActivityDetails(updatedDetails);
    await saveData(ACTIVITY_DETAILS_KEY, updatedDetails);
  };

  const deleteActivity = async (activityId: string) => {
    const updatedActivities = activities.filter(a => a.id !== activityId);
    setActivities(updatedActivities);
    await saveData(ACTIVITIES_KEY, updatedActivities);

    const updatedDetails = { ...activityDetails };
    delete updatedDetails[activityId];
    setActivityDetails(updatedDetails);
    await saveData(ACTIVITY_DETAILS_KEY, updatedDetails);
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
