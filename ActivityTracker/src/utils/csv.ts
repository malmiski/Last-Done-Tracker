import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { generateActivityId } from './crypto';
import * as database from './database';
import { Tag } from '../data/activity-details';

export const downloadCsv = async () => {
  try {
    const activities = await database.getActivities();

    if (!activities || activities.length === 0) {
      alert('No data to download.');
      return;
    }

    let csvContent = 'ActivityID,Activity,Icon,EntryID,StartDate,EndDate,Notes,Image,Tags\n';

    const escapeCSV = (field: string) => {
      if (field === undefined || field === null) return '';
      const stringField = String(field).replace(/\n/g, ' '); // Replace newlines with spaces for simplicity
      if (stringField.includes(',') || stringField.includes('"')) {
        return `"${stringField.replace(/"/g, '""')}"`;
      }
      return stringField;
    };

    for (const activity of activities) {
      const details = await database.getEntries(activity.id);
      details.forEach((detail: any) => {
        // Tag format: Name:Color
        const tagsString = (detail.tags || []).map((t: Tag) => `${t.name}:${t.color}`).join('|');
        const row = [
          activity.id,
          activity.name,
          activity.icon,
          detail.id,
          new Date(detail.startDate).toISOString(),
          new Date(detail.endDate).toISOString(),
          detail.notes || '',
          detail.image || '',
          tagsString
        ].map(escapeCSV).join(',');
        csvContent += row + '\n';
      });
    }

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

    const parseCSVLine = (line: string) => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cur);
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur);
      return result;
    };

    const header = parseCSVLine(lines[0]);
    const hasIds = header.includes('ActivityID') && header.includes('EntryID');
    const hasEndDate = header.includes('EndDate');
    const hasTags = header.includes('Tags');

    // Basic schema validation
    if (!header.includes('Activity') || (!header.includes('Date') && !header.includes('StartDate'))) {
        alert('Invalid CSV format: Missing required columns (Activity, Date/StartDate).');
        return;
    }

    const activities = await database.getActivities();
    const existingTags = await database.getTags();

    for (const line of lines.slice(1)) {
      if (!line || line.trim() === '') continue;
      const values = parseCSVLine(line);

      let activityId, activityName, icon, entryId, startDateString, endDateString, notes, image, tagsString;

      if (hasIds) {
        if (hasEndDate) {
            if (hasTags) {
                if (values.length < 9) continue;
                [activityId, activityName, icon, entryId, startDateString, endDateString, notes, image, tagsString] = values;
            } else {
                if (values.length < 8) continue;
                [activityId, activityName, icon, entryId, startDateString, endDateString, notes, image] = values;
            }
        } else {
            if (values.length < 7) continue;
            [activityId, activityName, icon, entryId, startDateString, notes, image] = values;
            endDateString = startDateString;
        }
      } else {
        if (hasEndDate) {
            if (values.length < 6) continue;
            [activityName, icon, startDateString, endDateString, notes, image] = values;
        } else {
            if (values.length < 5) continue;
            [activityName, icon, startDateString, notes, image] = values;
            endDateString = startDateString;
        }
        activityId = await generateActivityId(activityName);
        entryId = await generateActivityId(Math.random().toString());
      }

      if (!activityName || !startDateString) continue;

      let activity = activities.find((a: any) => a.id === activityId);
      if (!activity) {
        activity = {
          id: activityId,
          name: activityName,
          lastDone: 'Never',
          icon: icon,
        };
        await database.addActivity(activity);
        activities.push(activity);
      } else {
        if (activity.icon !== icon || activity.name !== activityName) {
          activity.icon = icon;
          activity.name = activityName;
          await database.updateActivity(activity);
        }
      }

      const entryTags: Tag[] = [];
      if (tagsString) {
          const tagDefinitions = tagsString.split('|');
          for (const tagDef of tagDefinitions) {
              if (!tagDef) continue;
              const [tagName, tagColor] = tagDef.split(':');
              let tag = existingTags.find(t => t.name === tagName);
              if (!tag) {
                  tag = {
                      id: await generateActivityId(tagName + Math.random()),
                      name: tagName,
                      color: tagColor || '#34C759', // Fallback to default green
                  };
                  await database.addTag(tag);
                  existingTags.push(tag);
              } else if (tagColor && tag.color !== tagColor) {
                  tag.color = tagColor;
                  await database.updateTag(tag);
              }
              entryTags.push(tag);
          }
      }

      const startDate = new Date(startDateString);
      const endDate = new Date(endDateString);
      const activityEntries = await database.getEntries(activityId);
      const existingEntry = activityEntries.find((d: any) => d.id === entryId || new Date(d.startDate).getTime() === startDate.getTime());

      if (!existingEntry) {
        await database.addEntry(activityId, {
          id: entryId,
          startDate,
          endDate,
          notes: notes || undefined,
          image: image || undefined,
          tags: entryTags,
        });
      } else {
        await database.updateEntry({
          id: existingEntry.id,
          startDate,
          endDate,
          notes: notes || existingEntry.notes,
          image: image || existingEntry.image,
          tags: entryTags,
        });
      }
    }

    alert('CSV data uploaded successfully.');
  } catch (error) {
    console.error('Failed to upload CSV', error);
    alert('Failed to upload CSV.');
  }
};
