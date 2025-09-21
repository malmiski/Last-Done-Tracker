import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import EnterPinScreen from '../screens/EnterPinScreen';
import SetPinScreen from '../screens/SetPinScreen';
import ActivitiesScreen from '../screens/ActivitiesScreen';
import AddActivityScreen from '../screens/AddActivityScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ActivityDetailScreen from '../screens/ActivityDetailScreen';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import theme from '../theme/theme';

const Stack = createStackNavigator();

export type RootStackParamList = {
  AuthLoading: undefined;
  Activities: undefined;
  Settings: undefined;
  AddActivity: undefined;
  ActivityDetail: { activityId: string };
  EnterPin: undefined;
  SetPin: undefined;
};

function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="AuthLoading"
        screenOptions={{
          headerShown: false,
          cardStyle: { flex: 1, backgroundColor: theme.colors.background },
          cardStyleInterpolator: CardStyleInterpolators.forFade,
        }}
      >
        <Stack.Screen name="AuthLoading" component={AuthLoadingScreen} options={{ cardStyleInterpolator: CardStyleInterpolators.forNoAnimation }}/>
        <Stack.Screen name="EnterPin" component={EnterPinScreen} />
        <Stack.Screen name="SetPin" component={SetPinScreen} />
        <Stack.Screen name="Activities" component={ActivitiesScreen} />
        <Stack.Screen name="AddActivity" component={AddActivityScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default RootNavigator;
