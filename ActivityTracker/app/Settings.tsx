import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import { exportBundle, getStorageEstimate, importBundle } from '../src/utils/backup';
import type { BackupProgress } from '../src/utils/backupTypes';
import { useActivityData } from '../src/hooks/useActivityData';
import {
  collectImageGarbage,
  runImageMigrationNow,
  subscribeToMigration,
  MigrationProgress,
} from '../src/utils/imageMigration';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const describeProgress = (progress: BackupProgress): string => {
  switch (progress.phase) {
    case 'entries': return `Writing entries… (${progress.completed})`;
    case 'images': return `Packing images… (${progress.completed}/${progress.total})`;
    case 'database': return 'Adding database…';
    case 'finalising': return 'Finishing…';
    case 'reading': return `Reading images… (${progress.completed})`;
    case 'restoring': return `Restoring entries… (${progress.completed}/${progress.total})`;
    default: return 'Working…';
  }
};

const SettingsScreen: React.FC = () => {
  const router = useRouter();
  const { clearAllHistory } = useActivityData();
  const [pinLock, setPinLock] = useState('');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [migration, setMigration] = useState<MigrationProgress | null>(null);

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await getStorageEstimate());
    } catch {
      setStorage(null);
    }
  }, []);

  useEffect(() => subscribeToMigration(setMigration), []);
  useEffect(() => { void refreshStorage(); }, [refreshStorage]);

  const loadPinLockState = useCallback(async () => {
    try {
      const storedUserPin = await AsyncStorage.getItem('@user_pin');
      setPinLock(storedUserPin && storedUserPin !== '' ? storedUserPin : '');
    } catch (e) {
      console.error('Failed to load pin lock state.', e);
      setPinLock('');
    }
  }, []);

  useEffect(() => { void loadPinLockState(); }, [loadPinLockState]);
  useFocusEffect(useCallback(() => { void loadPinLockState(); }, [loadPinLockState]));

  const handlePinLockToggle = (value: boolean) => {
    if (value) {
      router.push('/SetPin');
    } else {
      setPinLock('');
      AsyncStorage.setItem('@user_pin', '');
    }
  };

  const handleExport = async () => {
    setBusy('Preparing backup…');
    try {
      await exportBundle(progress => setBusy(describeProgress(progress)));
    } finally {
      setBusy(null);
      void refreshStorage();
    }
  };

  const handleImport = async () => {
    setBusy('Reading backup…');
    try {
      const result = await importBundle(progress => setBusy(describeProgress(progress)));
      if (result) {
        const parts = [`Imported ${result.entriesImported} entries`];
        if (result.imagesImported > 0) parts.push(`${result.imagesImported} images`);
        if (result.imagesMissing > 0) {
          parts.push(`${result.imagesMissing} images could not be restored`);
        }
        Alert.alert('Import complete', `${parts.join('\n')}.`);
      }
    } finally {
      setBusy(null);
      void refreshStorage();
    }
  };

  const handleFreeSpace = async () => {
    setBusy('Reclaiming space…');
    try {
      const removed = await collectImageGarbage();
      Alert.alert(
        'Done',
        removed > 0
          ? `Removed ${removed} unused image file${removed === 1 ? '' : 's'}.`
          : 'No unused images found.',
      );
    } finally {
      setBusy(null);
      void refreshStorage();
    }
  };

  const handleOptimise = async () => {
    setBusy('Optimising image storage…');
    try {
      await runImageMigrationNow();
    } finally {
      setBusy(null);
      void refreshStorage();
    }
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Delete all entries?',
      'This permanently removes every entry and every photo across all activities. Your activities themselves are kept. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setBusy('Deleting…');
            try {
              await clearAllHistory();
            } finally {
              setBusy(null);
              void refreshStorage();
            }
          },
        },
      ],
    );
  };

  const migrationPending = migration && migration.total > 0 && !migration.finished;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/Activities") } }}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {busy && (
          <View style={styles.busyBanner}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        )}

        {migrationPending && (
          <View style={styles.busyBanner}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.busyText}>
              Optimising image storage… {migration!.completed}/{migration!.total}
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.setting}>
          <View style={styles.settingLabel}>
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

        <Text style={styles.sectionTitle}>Tags</Text>
        <TouchableOpacity style={styles.setting} onPress={() => router.push('/ManageTags')}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingText}>Manage Tags</Text>
            <Text style={styles.settingSubtext}>Create, edit, and delete tags</Text>
          </View>
          <Icon name="tag-multiple-outline" size={24} color={theme.colors.text} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Backup</Text>
        <TouchableOpacity style={styles.setting} onPress={handleExport} disabled={!!busy}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingText}>Export backup</Text>
            <Text style={styles.settingSubtext}>
              A single .zip with your data and every photo
            </Text>
          </View>
          <Icon name="package-down" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.setting} onPress={handleImport} disabled={!!busy}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingText}>Import backup</Text>
            <Text style={styles.settingSubtext}>
              Restore from a .zip, or an older CSV export
            </Text>
          </View>
          <Icon name="package-up" size={24} color={theme.colors.text} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Storage</Text>
        <View style={styles.setting}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingText}>Photos on this device</Text>
            <Text style={styles.settingSubtext}>
              {storage
                ? Platform.OS === 'web'
                  ? `${formatBytes(storage.usage)} used of about ${formatBytes(storage.quota)} available to this site`
                  : `${formatBytes(storage.usage)} used · ${formatBytes(storage.quota)} free on device`
                : 'Calculating…'}
            </Text>
            {Platform.OS !== 'web' && (
              <Text style={styles.settingNote}>
                Photos are excluded from iCloud backup — use Export backup instead.
              </Text>
            )}
          </View>
          <Icon name="image-multiple-outline" size={24} color={theme.colors.text} />
        </View>

        <TouchableOpacity style={styles.setting} onPress={handleFreeSpace} disabled={!!busy}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingText}>Free up space</Text>
            <Text style={styles.settingSubtext}>
              Delete image files no entry uses any more
            </Text>
          </View>
          <Icon name="broom" size={24} color={theme.colors.text} />
        </TouchableOpacity>

        {migration && migration.total > 0 && !migration.finished && (
          <TouchableOpacity style={styles.setting} onPress={handleOptimise} disabled={!!busy}>
            <View style={styles.settingLabel}>
              <Text style={styles.settingText}>Optimise image storage now</Text>
              <Text style={styles.settingSubtext}>
                {migration.total - migration.completed} entries still use the old format
              </Text>
            </View>
            <Icon name="speedometer" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Danger zone</Text>
        <TouchableOpacity
          style={[styles.setting, styles.dangerSetting]}
          onPress={handleClearHistory}
          disabled={!!busy}
        >
          <View style={styles.settingLabel}>
            <Text style={[styles.settingText, styles.dangerText]}>Delete all entries</Text>
            <Text style={styles.settingSubtext}>
              Removes every entry and photo. Activities are kept.
            </Text>
          </View>
          <Icon name="trash-can-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </ScrollView>
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
    padding: 20,
    paddingBottom: 60,
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
  settingLabel: {
    flex: 1,
    paddingRight: 15,
  },
  dangerSetting: {
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  dangerText: {
    color: '#FF3B30',
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
  settingNote: {
    color: theme.colors.subtext,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  busyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 15,
    gap: 12,
    marginBottom: 10,
  },
  busyText: {
    color: theme.colors.text,
    fontSize: 15,
    flex: 1,
  },
});

export default SettingsScreen;
