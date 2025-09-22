import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import DateTimePicker from '@react-native-community/datetimepicker';

const EditEntryScreen: React.FC = () => {
  const router = useRouter();
  const { activityId, entryId } = useLocalSearchParams<{ activityId: string, entryId: string }>();
  const { activityDetails, updateActivityEntry, getActivityById } = useActivityData();

  const activity = getActivityById(activityId);
  const entry = activityDetails[activityId]?.find(e => e.id === entryId);

  const [date, setDate] = useState(entry ? entry.date : new Date());
  const [mode, setMode] = useState<'date' | 'time'>('date');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (entry) {
      setDate(entry.date);
    }
  }, [entry]);

  const onChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || date;
    setShow(Platform.OS === 'ios');
    setDate(currentDate);
  };

  const showMode = (currentMode: 'date' | 'time') => {
    setShow(true);
    setMode(currentMode);
  };

  const handleSave = () => {
    if (activityId && entryId) {
      updateActivityEntry(activityId, entryId, date);
      router.back();
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
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="close" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Entry for {activity.name}</Text>
        <View style={{ width: 30 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.label}>Date / Time</Text>
        <View style={styles.dateContainer}>
          <TouchableOpacity onPress={() => showMode('date')} style={styles.datePickerButton}>
            <Text style={styles.datePickerText}>{date.toLocaleDateString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => showMode('time')} style={styles.datePickerButton}>
            <Text style={styles.datePickerText}>{date.toLocaleTimeString()}</Text>
          </TouchableOpacity>
        </View>
        {show && (
          <DateTimePicker
            testID="dateTimePicker"
            value={date}
            mode={mode}
            is24Hour={true}
            display="default"
            onChange={onChange}
          />
        )}
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
