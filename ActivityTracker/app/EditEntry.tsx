import React, { useCallback, useState, useEffect, createElement } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import DateTimePicker from '@react-native-community/datetimepicker';

const WebDatePicker = (date, setDate, setShowDatePicker) => {
  const setCalendarDate = (event) => {
    const newDate = new Date(date);
    const dateString = event.target.value;
    const [year, month, day] = dateString.split('-').map(Number);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      newDate.setFullYear(year, month - 1, day);
      setDate(newDate);
    }
    setShowDatePicker(false);
  };

  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value: date.toISOString().split('T')[0],
      onChange: setCalendarDate
      ,
      style: { height: 30, padding: 5, border: "2px solid #677788", borderRadius: 5, width: 250 }
    })
  } else {
    return <DateTimePicker
      value={new Date(date)}
      mode="date"
      display="inline"
      onChange={(event, date) => setCalendarDate({target: {value: date.toISOString().split('T')[0]}})}
    />

  }
}
const WebTimePicker = (date, setDate, setShowTimePicker) => {
  const setDateTime = (event) => {
    const newDate = new Date(date);
    const timeString = event.target.value;
    const [hours, minutes, seconds] = timeString.split(':').map(Number);
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      newDate.setHours(hours, minutes, seconds);
      setDate(newDate);
    }
      setShowTimePicker(false);
  };
  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'time',
      step: 1,
      value: date.toTimeString().slice(0, 8),
      onChange: setDateTime,
      style: { height: 30, padding: 5, border: "2px solid #677788", borderRadius: 5, width: 250 }
    })
  } else {
    return <DateTimePicker
      value={new Date(date)}
      mode="time"
      display="inline"
      onChange={(event, time) => {
        var [hours, minutes, seconds] = time.toLocaleTimeString().substring(0, time.toLocaleTimeString().length - 3).split(":");
        const add12Hours = time.toLocaleTimeString().substring(time.toLocaleTimeString().length - 2) == 'PM';
        if(add12Hours){
          hours = parseInt(hours) + 12;
        }
        setDateTime({target: {value: hours + ":" + minutes + ":" + seconds}});
      }}
    />;
  }
}

const EditEntryScreen: React.FC = () => {
  const router = useRouter();
  const { activityId, entryId } = useLocalSearchParams<{ activityId: string, entryId: string }>();
  const { activityDetails, updateActivityEntry, getActivityById } = useActivityData();

  const activity = getActivityById(activityId);
  const entry = activityDetails[activityId]?.find(e => e.id === entryId);

  const [date, setDate] = useState(entry ? entry.date : new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    if (entry) {
      setDate(entry.date);
    }
  }, [entry]);

  const handleSave = () => {
    if (activityId && entryId) {
      updateActivityEntry(activityId, entryId, date);
      router.replace("/ActivityDetail?activityId=" + activityId);
    }
  };

  if (!activity || !entry) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Entry not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/ActivityDetail?activityId=" + activityId)}>
          <Icon name="close" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Entry for {activity.name}</Text>
        <View style={{ width: 30 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.label}>Date / Time</Text>
        <View style={styles.dateContainer}>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.datePickerButton}>
            <Text style={styles.datePickerText}>{date.toLocaleDateString()} </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowTimePicker(true)} style={styles.datePickerButton}>
            <Text style={styles.datePickerText}>{date.toLocaleTimeString()}</Text>
          </TouchableOpacity>
        </View>
        {showDatePicker && (
          WebDatePicker(date, setDate, setShowDatePicker)
        )}
        {showTimePicker &&
          WebTimePicker(date, setDate, setShowTimePicker)
        }
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>Save Changes</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  label: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  dateContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  datePickerButton: {
    backgroundColor: theme.colors.card,
    padding: 15,
    borderRadius: 10,
  },
  datePickerText: {
    color: theme.colors.primary,
    fontSize: 18,
  },
  footer: {
    padding: 20,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 30,
    padding: 20,
    alignItems: 'center',
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default EditEntryScreen;
