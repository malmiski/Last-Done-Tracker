import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import ActivityHistoryItem, { ImageMode } from '../src/components/ActivityHistoryItem';
import { useActivityData } from '../src/hooks/useActivityData';

const ActivityDetailScreen: React.FC = () => {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { activityDetails, getActivityById, addActivityEntry, deleteActivityEntry, refreshData } = useActivityData();
  const [imageMode, setImageMode] = useState<ImageMode>('small');
  const [searchQuery, setSearchQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (refreshData) {
        refreshData();
      }
    }, [refreshData])
  );

  const activity = getActivityById(activityId);
  const history = (activityDetails[activityId] || []).sort((a, b) => b.date.getTime() - a.date.getTime());

  const filteredHistory = history.filter(item =>
    (item.notes || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!activity) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Activity not found</Text>
      </SafeAreaView>
    );
  }

  const cycleImageMode = () => {
    setImageMode(prev => {
      if (prev === 'small') return 'medium';
      if (prev === 'medium') return 'large';
      if (prev === 'large') return 'hidden';
      return 'small';
    });
  };

  const getImageModeIcon = () => {
    switch (imageMode) {
      case 'small': return 'image-size-select-small';
      case 'medium': return 'image-size-select-actual';
      case 'large': return 'image-size-select-large';
      case 'hidden': return 'image-off-outline';
      default: return 'image-size-select-small';
    }
  };

  const handleAddEntry = async () => {
    const now = new Date();
    const newEntryId = await addActivityEntry(activityId, now, now);
    router.push(`/EditEntry?activityId=${activityId}&entryId=${newEntryId}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/Activities"); } }}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{activity.name}</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={cycleImageMode} style={{ paddingRight: 10 }}>
            <Icon name={getImageModeIcon()} size={30} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/EditActivity?activityId=${activityId}`)} style={{ paddingRight: 10 }}>
            <Icon name="pencil-outline" size={30} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/GraphView?activityId=${activityId}`)}>
            <Icon name="chart-line" size={30} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color={theme.colors.subtext} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search notes..."
          placeholderTextColor={theme.colors.subtext}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
      <FlatList
        data={filteredHistory}
        renderItem={({ item }) => (
          <ActivityHistoryItem
            startDate={item.startDate}
            endDate={item.endDate}
            notes={item.notes}
            image={item.image}
            imageMode={imageMode}
            onEdit={() => router.push(`/EditEntry?activityId=${activityId}&entryId=${item.id}`)}
            onDelete={() => deleteActivityEntry(activityId, item.id)}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={handleAddEntry}
      >
        <Icon name="plus" size={30} color={theme.colors.background} />
        <Text style={styles.fabText}>Add New Entry</Text>
      </TouchableOpacity>
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
  headerButtons: {
    flexDirection: 'row',
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 15,
    marginVertical: 10,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 17,
    paddingVertical: 12,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 100,
  },
  fab: {
    position: 'absolute',
    bottom: 40,
    right: 60,
    left: 60,
    backgroundColor: theme.colors.primary,
    borderRadius: 30,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});

export default ActivityDetailScreen;
