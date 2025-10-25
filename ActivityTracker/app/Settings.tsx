import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import { downloadCsv, uploadCsv } from '../src/utils/csv';

const SettingsScreen: React.FC = () => {
  const router = useRouter();
  const [pinLock, setPinLock] = useState('');

  useEffect(() => {
    const loadPinLockState = async () => {
      try {
        const storedUserPin = await AsyncStorage.getItem('@user_pin');
        if (storedUserPin !== null && storedUserPin !== '') {
          setPinLock(storedUserPin);
        }
      } catch (e) {
        console.error('Failed to load pin lock state.', e);
      }
    };
    loadPinLockState();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const loadPinLockState = async () => {
        try {
          const storedUserPin = await AsyncStorage.getItem('@user_pin');
          if (storedUserPin !== null && storedUserPin !== '') {
            setPinLock(storedUserPin);
          } else {
            setPinLock('');
          }
        } catch (e) {
          console.error('Failed to load pin lock state.', e);
          setPinLock('');
        }
      };
      loadPinLockState();
    }, [])
  );


  const handlePinLockToggle = (value: boolean) => {
    if (value) {
      router.push('/SetPin');
    } else {
      setPinLock('');
      AsyncStorage.setItem('@user_pin', '');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 30 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.setting}>
          <View>
            <Text style={styles.settingText}>PIN Lock</Text>
            <Text style={styles.settingSubtext}>Secure your app with a 4-digit PIN</Text>
          </View>
          <Switch
            trackColor={{ false: theme.colors.PINdot, true: theme.colors.primary }}
            thumbColor={theme.colors.text}
            onValueChange={handlePinLockToggle}
            value={pinLock !== null && pinLock !== ''}
          />
        </View>

        <Text style={styles.sectionTitle}>Data Management</Text>
        <TouchableOpacity style={styles.setting} onPress={downloadCsv}>
          <View>
            <Text style={styles.settingText}>Download CSV</Text>
            <Text style={styles.settingSubtext}>Download all your activities and data</Text>
          </View>
          <Icon name="download" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.setting} onPress={uploadCsv}>
          <View>
            <Text style={styles.settingText}>Upload CSV</Text>
            <Text style={styles.settingSubtext}>Upload a CSV with your data</Text>
          </View>
          <Icon name="upload" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => { /* Handle Save */ }}
        >
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
    paddingBottom: 10,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    color: theme.colors.subtext,
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 20,
  },
  setting: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  settingText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  settingSubtext: {
    color: theme.colors.subtext,
    fontSize: 14,
    marginTop: 5,
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

export default SettingsScreen;
