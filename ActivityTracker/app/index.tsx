import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import theme from '../src/theme/theme';

const AuthLoadingScreen: React.FC = () => {
  const router = useRouter();

  useEffect(() => {
    const checkPinLock = async () => {
      try {
        const userPin = await AsyncStorage.getItem('@user_pin');
        if (userPin !== null && userPin !== '') {
          router.replace('/EnterPin');
        } else {
          router.replace('/Activities');
        }
      } catch (e) {
        console.error('Failed to load pin lock state.', e);
        router.replace('/Activities');
      }
    };

    checkPinLock();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
});

export default AuthLoadingScreen;
