import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import theme from '../src/theme/theme';
import { RootSiblingParent } from 'react-native-root-siblings';
import { scheduleImageMigration } from '../src/utils/imageMigration';
import { clearImageMemoryCache } from '../src/components/AppImage';

function Layout() {
  useEffect(() => {
    // Converts any remaining inline-base64 rows to file-backed storage. Runs
    // after interactions settle so it never competes with the first scroll.
    scheduleImageMigration();
  }, []);

  useEffect(() => {
    // Hand decoded bitmaps back when the app is backgrounded. iOS is far more
    // likely to terminate a backgrounded app that is holding a lot of memory,
    // and none of those bitmaps are visible anyway.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        void clearImageMemoryCache();
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <RootSiblingParent>
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
    </RootSiblingParent>
  );
}

export default Layout;