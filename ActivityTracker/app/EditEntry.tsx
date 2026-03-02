import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as ImageManipulator from 'expo-image-manipulator';

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

  const [endYear, setEndYear] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [endDay, setEndDay] = useState('');
  const [endHour, setEndHour] = useState('');
  const [endMinute, setEndMinute] = useState('');
  const [endSecond, setEndSecond] = useState('');
  const [endAmpm, setEndAmpm] = useState('');

  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<string | undefined>(undefined);
  const [isFormValidState, setIsFormValidState] = useState(false);

  const isFormValid = () => {
    const validate = (y, m, d, h, min, s, ampmVal) => {
        const numMonth = parseInt(m, 10);
        const numDay = parseInt(d, 10);
        const numYear = parseInt(y, 10);
        const numHour = parseInt(h, 10);
        const numMinute = parseInt(min, 10);
        const numSecond = parseInt(s, 10);

        const isMonthValid = !isNaN(numMonth) && numMonth >= 1 && numMonth <= 12;
        const isDayValid = !isNaN(numMonth) && !isNaN(numDay) && !isNaN(numYear) &&
                        numMonth >= 1 && numMonth <= 12 &&
                        numDay >= 1 && numDay <= new Date(numYear, numMonth, 0).getDate();
        const isYearValid = !isNaN(numYear) && numYear > 0;
        const isHourValid = !isNaN(numHour) && numHour >= 1 && numHour <= 12;
        const isMinuteValid = !isNaN(numMinute) && numMinute >= 0 && numMinute <= 59;
        const isSecondValid = !isNaN(numSecond) && numSecond >= 0 && numSecond <= 59;
        const isAmpmValid = ampmVal.toUpperCase() === 'AM' || ampmVal.toUpperCase() === 'PM';

        return isMonthValid && isDayValid && isYearValid && isHourValid && isMinuteValid && isSecondValid && isAmpmValid;
    };

    const startValid = validate(year, month, day, hour, minute, second, ampm);
    const endValid = validate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);

    if (!startValid || !endValid) return false;

    // Check that end date is not before start date
    const getFullDate = (y, m, d, h, min, s, ampmVal) => {
        let hours = parseInt(h, 10);
        if (ampmVal.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (ampmVal.toUpperCase() === 'AM' && hours === 12) hours = 0;
        return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hours, parseInt(min, 10), parseInt(s, 10));
    };

    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);

    return end >= start;
  };


  useEffect(() => {
    if (entry) {
      const entryDate = new Date(entry.startDate);
      setYear(entryDate.getFullYear().toString());
      setMonth((entryDate.getMonth() + 1).toString());
      setDay(entryDate.getDate().toString());
      let hours = entryDate.getHours();
      const ampmVal = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      setHour(hours.toString());
      setMinute(entryDate.getMinutes().toString().padStart(2, '0'));
      setSecond(entryDate.getSeconds().toString().padStart(2, '0'));
      setAmpm(ampmVal);

      const endDate = new Date(entry.endDate);
      setEndYear(endDate.getFullYear().toString());
      setEndMonth((endDate.getMonth() + 1).toString());
      setEndDay(endDate.getDate().toString());
      let endHours = endDate.getHours();
      const endAmpmVal = endHours >= 12 ? 'PM' : 'AM';
      endHours = endHours % 12;
      endHours = endHours ? endHours : 12;
      setEndHour(endHours.toString());
      setEndMinute(endDate.getMinutes().toString().padStart(2, '0'));
      setEndSecond(endDate.getSeconds().toString().padStart(2, '0'));
      setEndAmpm(endAmpmVal);

      setNotes(entry.notes || '');
      setImage(entry.image);
    }
  }, [entry]);

  useEffect(() => {
    setIsFormValidState(isFormValid());
  }, [year, month, day, hour, minute, second, ampm, endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm]);

  const convertToJpeg = async (uri: string) => {
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    return `data:image/jpeg;base64,${manipResult.base64}`;
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets[0].uri) {
      const jpegBase64 = await convertToJpeg(result.assets[0].uri);
      setImage(jpegBase64);
    }
  };

  const pasteImage = async () => {
    const hasImage = await Clipboard.hasImageAsync();
    if (hasImage) {
      const imageBase64 = await Clipboard.getImageAsync({ format: 'png' }); // Clipboard currently only supports png/jpg
      if (imageBase64 && imageBase64.data) {
        // Convert the pasted image to JPEG base64 to be consistent
        const jpegBase64 = await convertToJpeg(imageBase64.data);
        setImage(jpegBase64);
      }
    } else {
      Alert.alert("No image found in clipboard");
    }
  };

  const getFullDate = (y, m, d, h, min, s, ampmVal) => {
    let hours = parseInt(h, 10);
    if (ampmVal.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (ampmVal.toUpperCase() === 'AM' && hours === 12) hours = 0;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hours, parseInt(min, 10), parseInt(s, 10));
  };

  const updateEndStates = (date: Date) => {
    setEndYear(date.getFullYear().toString());
    setEndMonth((date.getMonth() + 1).toString());
    setEndDay(date.getDate().toString());
    let hours = date.getHours();
    const ampmVal = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    setEndHour(hours.toString());
    setEndMinute(date.getMinutes().toString().padStart(2, '0'));
    setEndSecond(date.getSeconds().toString().padStart(2, '0'));
    setEndAmpm(ampmVal);
  };

  const adjustEndTime = (minutes: number) => {
    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);
    let newEnd = new Date(end.getTime() + minutes * 60000);
    if (newEnd < start) {
        newEnd = start;
    }
    updateEndStates(newEnd);
  };

  const handleSave = () => {
    if (activityId && entryId && isFormValid()) {
      const startDate = getFullDate(year, month, day, hour, minute, second, ampm);
      const endDate = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);
      updateActivityEntry(activityId, entryId, startDate, endDate, notes, image);
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
      <ScrollView style={styles.content}>
        <Text style={styles.sectionLabel}>Start Date & Time</Text>
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

        <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>End Date & Time</Text>
            <View style={styles.quickActions}>
                <TouchableOpacity onPress={() => adjustEndTime(5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+5m</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(-5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-5m</Text>
                </TouchableOpacity>
            </View>
        </View>
        <Text style={styles.label}>Date</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={endMonth}
            onChangeText={setEndMonth}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={styles.input}
            placeholder="DD"
            value={endDay}
            onChangeText={setEndDay}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={[styles.input, {width: 80}] }
            placeholder="YYYY"
            value={endYear}
            onChangeText={setEndYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
        <Text style={styles.label}>Time</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="HH"
            value={endHour}
            onChangeText={setEndHour}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={endMinute}
            onChangeText={setEndMinute}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="SS"
            value={endSecond}
            onChangeText={setEndSecond}
            keyboardType="number-pad"
            maxLength={2}
          />
          <TextInput
            style={[styles.input, { width: 60 , marginLeft: 15}]}
            placeholder="AM/PM"
            value={endAmpm}
            onChangeText={setEndAmpm}
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
        <Text style={[styles.label, { marginTop: 20 }]}>Photo</Text>
        <View style={styles.imageActions}>
          <TouchableOpacity style={styles.imageButton} onPress={pickImage}>
            <Icon name="image-plus" size={24} color={theme.colors.text} />
            <Text style={styles.imageButtonText}>Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.imageButton} onPress={pasteImage}>
            <Icon name="clipboard-arrow-down-outline" size={24} color={theme.colors.text} />
            <Text style={styles.imageButtonText}>Paste</Text>
          </TouchableOpacity>
          {image && (
            <TouchableOpacity style={styles.imageButton} onPress={() => setImage(undefined)}>
              <Icon name="delete-outline" size={24} color={theme.colors.error || '#FF3B30'} />
              <Text style={[styles.imageButtonText, { color: theme.colors.error || '#FF3B30' }]}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
        {image && (
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: image }} style={styles.imagePreview} />
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
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
    paddingHorizontal: 20,
  },
  sectionLabel: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 15,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  quickButton: {
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  quickButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
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
    height: 120,
    textAlignVertical: 'top',
  },
  imageActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 15,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: 10,
    borderRadius: 10,
    gap: 5,
  },
  imageButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  imagePreviewContainer: {
    marginTop: 10,
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 10,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    resizeMode: 'contain',
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
