import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, SectionList } from 'react-native';
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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [entries, setEntries] = useState<(ActivityEntry & { activityId: string })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchEntries = useCallback(async (tagIds: string[]) => {
    if (tagIds.length === 0) {
      setEntries([]);
      return;
    }

    // Fetch entries for all selected tags
    const allFetchedEntries: (ActivityEntry & { activityId: string })[] = [];
    const entryIds = new Set<string>();

    for (const tagId of tagIds) {
      const tagEntries = await database.getEntriesByTag(tagId);
      tagEntries.forEach(entry => {
        if (!entryIds.has(entry.id)) {
          entryIds.add(entry.id);
          allFetchedEntries.push(entry);
        }
      });
    }

    // Sort combined entries by date desc
    allFetchedEntries.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    setEntries(allFetchedEntries);
  }, []);

  useEffect(() => {
    fetchEntries(selectedTagIds);
  }, [selectedTagIds, fetchEntries]);

  useFocusEffect(
    useCallback(() => {
      fetchEntries(selectedTagIds);
      refreshData();
    }, [selectedTagIds, fetchEntries, refreshData])
  );

  const filteredEntries = entries.filter(entry => {
    const activity = activities.find(a => a.id === entry.activityId);
    const searchContent = `${activity?.name || ''} ${entry.notes || ''}`.toLowerCase();
    return searchContent.includes(searchQuery.toLowerCase());
  });

  const groupedEntries = useMemo(() => {
    const groups: { [key: string]: { title: string, data: (ActivityEntry & { activityId: string })[] } } = {};

    filteredEntries.forEach(entry => {
      const activity = activities.find(a => a.id === entry.activityId);
      const activityName = activity?.name || 'Unknown Activity';

      if (!groups[entry.activityId]) {
        groups[entry.activityId] = {
          title: activityName,
          data: []
        };
      }
      groups[entry.activityId].data.push(entry);
    });

    return Object.values(groups).sort((a, b) => a.title.localeCompare(b.title));
  }, [filteredEntries, activities]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleDeleteEntry = async (activityId: string, entryId: string) => {
    await deleteActivityEntry(activityId, entryId);
    fetchEntries(selectedTagIds);
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
          {tags.map(tag => {
            const isSelected = selectedTagIds.includes(tag.id);
            return (
              <TouchableOpacity
                key={tag.id}
                style={[
                  styles.tagButton,
                  { backgroundColor: tag.color },
                  isSelected && styles.selectedTagButton
                ]}
                onPress={() => toggleTag(tag.id)}
              >
                <Text style={styles.tagButtonText}>{tag.name}</Text>
                {isSelected && <Icon name="check" size={14} color="#FFFFFF" style={{ marginLeft: 5 }} />}
              </TouchableOpacity>
            );
          })}
          {tags.length === 0 && <Text style={styles.noTagsText}>No tags available. Create some in Settings.</Text>}
        </ScrollView>
      </View>

      {selectedTagIds.length > 0 && (
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

      <SectionList
        sections={groupedEntries}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.activityLabel}>{title}</Text>
        )}
        renderItem={({ item }) => (
          <ActivityHistoryItem
            startDate={item.startDate}
            endDate={item.endDate}
            notes={item.notes}
            image={item.image}
            tags={item.tags}
            onEdit={() => router.push(`/EditEntry?activityId=${item.activityId}&entryId=${item.id}`)}
            onDelete={() => handleDeleteEntry(item.activityId, item.id)}
          />
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Icon name={selectedTagIds.length > 0 ? "timer-sand-empty" : "tag-multiple-outline"} size={60} color={theme.colors.disabled} />
            <Text style={styles.emptyText}>
              {selectedTagIds.length > 0 ? "No entries found for these tags." : "Select one or more tags above to see entries."}
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
    opacity: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 10,
    backgroundColor: theme.colors.background,
    paddingVertical: 5,
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
