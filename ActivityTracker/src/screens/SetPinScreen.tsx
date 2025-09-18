import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../theme/theme';
import PinInputBox from '../components/PinInputBox';
import { StackNavigationProp } from '@react-navigation/stack';

type RootStackParamList = {
  SetPin: undefined;
  // Add other screens here
};

type SetPinScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'SetPin'
>;

interface Props {
  navigation: SetPinScreenNavigationProp;
}

const SetPinScreen: React.FC<Props> = ({ navigation }) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

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
        <TouchableOpacity style={styles.button} onPress={() => { /* Handle Cancel */ }}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={() => { /* Handle Save */ }}>
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
