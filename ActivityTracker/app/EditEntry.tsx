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
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<string | undefined>(undefined);
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
      setImage(entry.image);
    }
  }, [entry]);

  useEffect(() => {
    setIsFormValidState(isFormValid());
  }, [year, month, day, hour, minute, second, ampm]);

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
      updateActivityEntry(activityId, entryId, newDate, notes, image);
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
