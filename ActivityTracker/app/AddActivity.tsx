import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import IconGrid from '../src/components/IconGrid';
import { Calendar } from 'react-native-calendars';
import { useRouter } from 'expo-router';

const AddActivityScreen: React.FC = () => {
  const router = useRouter();
  const [activityName, setActivityName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('run');
  const [selectedDate, setSelectedDate] = useState('');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="close" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Add Activity</Text>
        <View style={{ width: 30 }} />
      </View>
      <ScrollView>
        <View style={styles.form}>
          <Text style={styles.label}>Activity Name</Text>
          <TextInput
            style={styles.input}
            placeholder="E.g., Read a book"
            placeholderTextColor={theme.colors.subtext}
            value={activityName}
            onChangeText={setActivityName}
          />

          <Text style={styles.label}>Choose an Icon</Text>
          <IconGrid selectedIcon={selectedIcon} onSelectIcon={setSelectedIcon} />

          <Text style={styles.label}>Last Done</Text>
          <Calendar
            onDayPress={day => setSelectedDate(day.dateString)}
            markedDates={{
              [selectedDate]: { selected: true, selectedColor: theme.colors.primary },
            }}
            theme={{
              backgroundColor: theme.colors.background,
              calendarBackground: theme.colors.card,
              textSectionTitleColor: theme.colors.subtext,
              selectedDayBackgroundColor: theme.colors.primary,
              selectedDayTextColor: '#ffffff',
              todayTextColor: theme.colors.primary,
              dayTextColor: theme.colors.text,
              textDisabledColor: theme.colors.PINdot,
              dotColor: theme.colors.primary,
              selectedDotColor: '#ffffff',
              arrowColor: theme.colors.primary,
              monthTextColor: theme.colors.text,
              indicatorColor: 'blue',
              textDayFontWeight: '300',
              textMonthFontWeight: 'bold',
              textDayHeaderFontWeight: '300',
              textDayFontSize: 16,
              textMonthFontSize: 16,
              textDayHeaderFontSize: 16,
            }}
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => { /* Handle Save */ }}
        >
          <Text style={styles.buttonText}>Save Activity</Text>
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
    paddingBottom: 10,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  form: {
    padding: 20,
  },
  label: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    marginTop: 20,
  },
  input: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    borderRadius: 10,
    padding: 20,
    fontSize: 17,
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

export default AddActivityScreen;
