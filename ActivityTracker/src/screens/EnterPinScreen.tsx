import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import theme from '../theme/theme';
import PinInput from '../components/PinInput';
import NumericKeypad from '../components/NumericKeypad';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';

type EnterPinScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'EnterPin'
>;

interface Props {
  navigation: EnterPinScreenNavigationProp;
}

const EnterPinScreen: React.FC<Props> = ({ navigation }) => {
  const [pin, setPin] = useState('');

  const handleKeyPress = (value: string) => {
    if (pin.length < 4) {
      setPin(pin + value);
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  const handleSubmit = async () => {
    try {
      const storedPin = await AsyncStorage.getItem('@user_pin');
      console.log("Stored pin is" + storedPin);
      if (storedPin === null || storedPin === '' || pin === storedPin) {
        navigation.replace('Activities');
      } else {
        Alert.alert('Invalid PIN', 'The PIN you entered is incorrect.');
        setPin('');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to verify PIN.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>Enter PIN</Text>
        <View style={styles.pinContainer}>
          <PinInput pinLength={4} filledDots={pin.length} />
        </View>
        <NumericKeypad
          onPress={handleKeyPress}
          onBackspace={handleBackspace}
          onSubmit={handleSubmit}
        />
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
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
