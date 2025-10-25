import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const downloadCsv = async () => {
  try {
    const activitiesJson = await AsyncStorage.getItem('@activities');
    const activityDetailsJson = await AsyncStorage.getItem('@activityDetails');

    if (!activitiesJson || !activityDetailsJson) {
      alert('No data to download.');
      return;
    }

    const activities = JSON.parse(activitiesJson);
    const activityDetails = JSON.parse(activityDetailsJson);

    let csvContent = 'Activity,Icon,Date\n';

    activities.forEach((activity: any) => {
      const details = activityDetails[activity.id] || [];
      details.forEach((detail: any) => {
        csvContent += `${activity.name},${activity.icon},${new Date(detail.date).toISOString()}\n`;
      });
    });

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.setAttribute('download', 'activities.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const file = new File(Paths.cache, 'activities.csv');
      await file.write(csvContent);
      await Sharing.shareAsync(file.uri);
    }
  } catch (error) {
    console.error('Failed to download CSV', error);
    alert('Failed to download CSV.');
  }
};

export const uploadCsv = async () => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'text/csv',
    });

    if (result.canceled) {
      return;
    }
    let csvContent = '';
    if (Platform.OS === 'web') {
      const file = result.assets[0].file;
      if (file) {
        csvContent = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });
      }
    } else {
      const file = new File(result.assets[0].uri);
      csvContent = await file.text();
    }
    const lines = csvContent.split('\n');

    const activitiesJson = await AsyncStorage.getItem('@activities');
    const activityDetailsJson = await AsyncStorage.getItem('@activityDetails');

    const   activities = activitiesJson ? JSON.parse(activitiesJson) : [];
    const activityDetails = activityDetailsJson ? JSON.parse(activityDetailsJson) : {};

    lines.slice(1).forEach(line => {
      if (!line) return;
      const [activityName, icon, dateString] = line.split(',');

      let activity = activities.find((a: any) => a.name === activityName);
      if (!activity) {
        activity = {
          id: Date.now().toString() + Math.random(),
          name: activityName,
          lastDone: 'Never',
          icon: icon,
        };
        activities.push(activity);
        activityDetails[activity.id] = [];
      }else{
        if(activity.icon !== icon){
          activity.icon = icon;
        }
      }

      const date = new Date(dateString);
      const exists = activityDetails[activity.id].some((d: any) => new Date(d.date).getTime() === date.getTime());

      if (!exists) {
        activityDetails[activity.id].push({
          id: Date.now().toString() + Math.random(),
          date,
        });
      }
    });

    await AsyncStorage.setItem('@activities', JSON.stringify(activities));
    await AsyncStorage.setItem('@activityDetails', JSON.stringify(activityDetails));

    alert('CSV data uploaded successfully.');
  } catch (error) {
    console.error('Failed to upload CSV', error);
    alert('Failed to upload CSV.');
  }
};
