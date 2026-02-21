import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';

const EditEntryScreen: React.FC = () => {
  const router = useRouter();
  const { activityId, entryId } = useLocalSearchParams<{ activityId: string, entryId: string }>();
  const { activityDetails, updateActivityEntry, getActivityById } = useActivityData();

  const activity = getActivityById(activityId);
  const entry = activityDetails[activityId]?.find(e => e.id === entryId);

  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [second, setSecond] = useState('');
  const [ampm, setAmpm] = useState('');
  const [notes, setNotes] = useState('');
  const [isFormValidState, setIsFormValidState] = useState(false);

  const isFormValid = () => {
    const numMonth = parseInt(month, 10);
    const numDay = parseInt(day, 10);
    const numYear = parseInt(year, 10);
    const numHour = parseInt(hour, 10);
    const numMinute = parseInt(minute, 10);
    const numSecond = parseInt(second, 10);

    const isMonthValid = !isNaN(numMonth) && numMonth >= 1 && numMonth <= 12;
    const isDayValid = !isNaN(numMonth) && !isNaN(numDay) && !isNaN(numYear) &&
                       numMonth >= 1 && numMonth <= 12 &&
                       numDay >= 1 && numDay <= new Date(numYear, numMonth, 0).getDate();
    const isYearValid = !isNaN(numYear) && numYear > 0;
    const isHourValid = !isNaN(numHour) && numHour >= 1 && numHour <= 12;
    const isMinuteValid = !isNaN(numMinute) && numMinute >= 0 && numMinute <= 59;
    const isSecondValid = !isNaN(numSecond) && numSecond >= 0 && numSecond <= 59;
    const isAmpmValid = ampm.toUpperCase() === 'AM' || ampm.toUpperCase() === 'PM';

    return isMonthValid && isDayValid && isYearValid && isHourValid && isMinuteValid && isSecondValid && isAmpmValid;
  };


  useEffect(() => {
    if (entry) {
      const entryDate = new Date(entry.date);
      setYear(entryDate.getFullYear().toString());
      setMonth((entryDate.getMonth() + 1).toString());
      setDay(entryDate.getDate().toString());
      let hours = entryDate.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // the hour '0' should be '12'
      setHour(hours.toString());
      setMinute(entryDate.getMinutes().toString().padStart(2, '0'));
      setSecond(entryDate.getSeconds().toString().padStart(2, '0'));
      setAmpm(ampm);
      setNotes(entry.notes || '');
    }
  }, [entry]);

  useEffect(() => {
    setIsFormValidState(isFormValid());
  }, [year, month, day, hour, minute, second, ampm]);

  const handleSave = () => {
    if (activityId && entryId && isFormValid()) {
      let hours = parseInt(hour, 10);
      if (ampm.toUpperCase() === 'PM' && hours < 12) {
        hours += 12;
      }
      if (ampm.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
      }
      const newDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hours, parseInt(minute, 10), parseInt(second, 10));
      updateActivityEntry(activityId, entryId, newDate, notes);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(`/ActivityDetail?activityId=${activityId}`);
      }
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
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/ActivityDetail?activityId=${activityId}`);
          }
        }}>
          <Icon name="close" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Entry for {activity.name}</Text>
        <View style={{ width: 30 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.label}>Date</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={month}
            onChangeText={setMonth}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={styles.input}
            placeholder="DD"
            value={day}
            onChangeText={setDay}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={[styles.input, {width: 80}] }
            placeholder="YYYY"
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
        <Text style={styles.label}>Time</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="HH"
            value={hour}
            onChangeText={setHour}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={minute}
            onChangeText={setMinute}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="SS"
            value={second}
            onChangeText={setSecond}
            keyboardType="number-pad"
            maxLength={2}
          />
          <TextInput
            style={[styles.input, { width: 60 , marginLeft: 15}]}
            placeholder="AM/PM"
            value={ampm}
            onChangeText={setAmpm}
            maxLength={2}
          />
        </View>
        <Text style={[styles.label, { marginTop: 20 }]}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add notes here..."
          placeholderTextColor={theme.colors.subtext}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={[styles.button, !isFormValidState && styles.disabledButton]} onPress={handleSave} disabled={!isFormValidState}>
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  input: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    padding: 15,
    borderRadius: 10,
    fontSize: 18,
    width: 60,
    textAlign: 'center',
  },
  separator: {
    color: theme.colors.text,
    fontSize: 18,
    marginHorizontal: 10,
  },
  notesInput: {
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    padding: 15,
    color: theme.colors.text,
    fontSize: 16,
    height: 150,
    textAlignVertical: 'top',
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
  disabledButton: {
    backgroundColor: theme.colors.disabled,
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default EditEntryScreen;
