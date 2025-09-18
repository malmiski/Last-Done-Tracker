import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../theme/theme';
import PinInput from '../components/PinInput';
import NumericKeypad from '../components/NumericKeypad';

const EnterPinScreen = () => {
  const [pin, setPin] = useState('');

  const handleKeyPress = (value: string) => {
    if (pin.length < 6) {
      setPin(pin + value);
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Enter PIN</Text>
        <View style={styles.pinContainer}>
          <PinInput pinLength={6} filledDots={pin.length} />
        </View>
        <NumericKeypad onPress={handleKeyPress} onBackspace={handleBackspace} />
      </View>
      <View style={styles.footer}>
        <TouchableOpacity>
          <Text style={styles.footerText}>Forgot PIN?</Text>
        </TouchableOpacity>
        <TouchableOpacity>
          <Text style={[styles.footerText, styles.sosText]}>SOS Emergency</Text>
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
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
  },
  pinContainer: {
    marginBottom: 60,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  footerText: {
    color: theme.colors.subtext,
    fontSize: 16,
    marginBottom: 20,
  },
  sosText: {
    color: theme.colors.SOS,
    fontWeight: 'bold',
  },
});

export default EnterPinScreen;
