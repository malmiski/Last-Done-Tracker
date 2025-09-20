import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import theme from '../theme/theme';

type AuthLoadingScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'AuthLoading'
>;

interface Props {
  navigation: AuthLoadingScreenNavigationProp;
}

const AuthLoadingScreen: React.FC<Props> = ({ navigation }) => {
  useEffect(() => {
    const checkPinLock = async () => {
      try {
        const pinLock = await AsyncStorage.getItem('@pinLock');
        if (pinLock === 'true') {
          navigation.replace('EnterPin');
        } else {
          navigation.replace('Activities');
        }
      } catch (e) {
        console.error('Failed to load pin lock state.', e);
        navigation.replace('Activities');
      }
    };

    checkPinLock();
  }, [navigation]);

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
