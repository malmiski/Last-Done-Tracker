import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import theme from '../src/theme/theme';
import PinInputBox from '../src/components/PinInputBox';
import { useRouter } from 'expo-router';
import { hashPin } from '../src/utils/crypto';

const SetPinScreen: React.FC = () => {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const handleSave = async () => {
    if (pin.length !== 4) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('PINs do not match', 'Please make sure your PINs match.');
      return;
    }
    try {
      const hashedPin = await hashPin(pin);
      await AsyncStorage.setItem('@user_pin', hashedPin);
      Alert.alert('PIN Saved', 'Your new PIN has been saved successfully.');
      router.replace('/EnterPin');
    } catch (e) {
      Alert.alert('Error', 'Failed to save PIN.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Set Your PIN</Text>
        <Text style={styles.subtitle}>Enter a 4-digit PIN to secure your app.</Text>
      </View>
      <View style={styles.pinContainer}>
        <PinInputBox pinLength={4} pin={pin} onPinChange={setPin} />
        <View style={{ height: 20 }} />
        <PinInputBox pinLength={4} pin={confirmPin} onPinChange={setConfirmPin} />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.button} onPress={() => router.replace("/Settings")}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={handleSave}>
          <Text style={[styles.buttonText, styles.saveButtonText]}>Save PIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'space-between',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    color: theme.colors.subtext,
    fontSize: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  pinContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  button: {
    flex: 1,
    padding: 20,
    borderRadius: 30,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: theme.colors.primary,
    marginLeft: 10,
  },
  buttonText: {
    color: theme.colors.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  saveButtonText: {
    color: theme.colors.background,
  },
});

export default SetPinScreen;
