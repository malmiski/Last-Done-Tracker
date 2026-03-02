import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import { Tag, ActivityEntry } from '../src/data/activity-details';
import ActivityHistoryItem from '../src/components/ActivityHistoryItem';
import * as database from '../src/utils/database';

const SearchByTagScreen: React.FC = () => {
  const router = useRouter();
  const { tags, activities, deleteActivityEntry, refreshData } = useActivityData();
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);
  const [entries, setEntries] = useState<(ActivityEntry & { activityId: string })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchEntries = useCallback(async (tagId: string) => {
    const fetchedEntries = await database.getEntriesByTag(tagId);
    setEntries(fetchedEntries);
  }, []);

  useEffect(() => {
    if (selectedTag) {
      fetchEntries(selectedTag.id);
    } else {
      setEntries([]);
    }
  }, [selectedTag, fetchEntries]);

  useFocusEffect(
    useCallback(() => {
      if (selectedTag) {
        fetchEntries(selectedTag.id);
      }
      refreshData();
    }, [selectedTag, fetchEntries, refreshData])
  );

  const filteredEntries = entries.filter(entry => {
    const activity = activities.find(a => a.id === entry.activityId);
    const searchContent = `${activity?.name || ''} ${entry.notes || ''}`.toLowerCase();
    return searchContent.includes(searchQuery.toLowerCase());
  });

  const handleDeleteEntry = async (activityId: string, entryId: string) => {
    await deleteActivityEntry(activityId, entryId);
    if (selectedTag) {
        fetchEntries(selectedTag.id);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Search by Tag</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.tagSelector}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagScroll}>
          {tags.map(tag => (
            <TouchableOpacity
              key={tag.id}
              style={[
                styles.tagButton,
                { backgroundColor: tag.color },
                selectedTag?.id === tag.id && styles.selectedTagButton
              ]}
              onPress={() => setSelectedTag(tag)}
            >
              <Text style={styles.tagButtonText}>{tag.name}</Text>
            </TouchableOpacity>
          ))}
          {tags.length === 0 && <Text style={styles.noTagsText}>No tags available. Create some in Settings.</Text>}
        </ScrollView>
      </View>

      {selectedTag && (
        <View style={styles.searchBar}>
          <Icon name="magnify" size={20} color={theme.colors.subtext} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search entries..."
            placeholderTextColor={theme.colors.subtext}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      )}

      <FlatList
        data={filteredEntries}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const activity = activities.find(a => a.id === item.activityId);
          return (
            <View>
              <Text style={styles.activityLabel}>{activity?.name || 'Unknown Activity'}</Text>
              <ActivityHistoryItem
                startDate={item.startDate}
                endDate={item.endDate}
                notes={item.notes}
                image={item.image}
                tags={item.tags}
                onEdit={() => router.push(`/EditEntry?activityId=${item.activityId}&entryId=${item.id}`)}
                onDelete={() => handleDeleteEntry(item.activityId, item.id)}
              />
            </View>
          );
        }}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Icon name={selectedTag ? "timer-sand-empty" : "tag-multiple-outline"} size={60} color={theme.colors.disabled} />
            <Text style={styles.emptyText}>
              {selectedTag ? "No entries found for this tag." : "Select a tag above to see entries."}
            </Text>
          </View>
        )}
      />
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
  tagSelector: {
    marginVertical: 10,
  },
  tagScroll: {
    paddingHorizontal: 20,
    gap: 10,
  },
  tagButton: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    opacity: 0.7,
  },
  selectedTagButton: {
    opacity: 1,
    borderWidth: 2,
    borderColor: theme.colors.text,
  },
  tagButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  noTagsText: {
    color: theme.colors.subtext,
    fontStyle: 'italic',
  },
  searchBar: {
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
    fontSize: 16,
    paddingVertical: 12,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  activityLabel: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
    marginLeft: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: theme.colors.disabled,
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
});

export default SearchByTagScreen;
