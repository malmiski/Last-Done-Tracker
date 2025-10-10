import React from 'react';
import { Stack } from 'expo-router';
import theme from '../src/theme/theme';

function Layout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { flex: 1, backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="EnterPin"
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.background },
          headerShadowVisible: false,
          headerTitle: '',
        }}
      />
      <Stack.Screen name="SetPin" />
      <Stack.Screen name="Activities" />
      <Stack.Screen name="AddActivity" />
      <Stack.Screen name="Settings" />
      <Stack.Screen name="ActivityDetail" />
    </Stack>
  );
}

export default Layout;
