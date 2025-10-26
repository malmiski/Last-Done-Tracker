import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import IconGrid from '../src/components/IconGrid';
import { useRouter } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';

const AddActivityScreen: React.FC = () => {
  const router = useRouter();
  const { addActivity } = useActivityData();
  const [activityName, setActivityName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('run');

  const handleSave = async () => {
    if (activityName.trim() === '') return;
    try {
      await addActivity({ name: activityName, icon: selectedIcon });
      router.replace("/Activities");
    } catch (error) {
      if (error instanceof Error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Error', 'An unknown error occurred.');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/Activities")}>
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
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={handleSave}
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
