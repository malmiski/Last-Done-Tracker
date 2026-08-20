import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import { useEntriesByTags, ListEntry } from '../src/hooks/useEntries';
import ActivityHistoryItem, { ImageMode } from '../src/components/ActivityHistoryItem';
import { clearImageMemoryCache } from '../src/components/AppImage';

/**
 * The tag block is a fixed number of rows tall and scrolls within itself.
 *
 * Letting it grow with the number of tags would push the results off the
 * screen on any account with a decent tag list — and the results are the point
 * of the page. Capping it means the entries below always start in the same
 * place, however many tags exist.
 *
 * The height is computed rather than guessed so the cap lands on a row
 * boundary plus a sliver of the next one, which is what makes it obvious the
 * block scrolls.
 */
const TAG_PILL_PADDING_VERTICAL = 8;
const TAG_PILL_LINE_HEIGHT = 18;
const TAG_PILL_HEIGHT = TAG_PILL_LINE_HEIGHT + TAG_PILL_PADDING_VERTICAL * 2;
const TAG_GAP = 10;
const TAG_VISIBLE_ROWS = 5;
const TAG_BLOCK_MAX_HEIGHT =
  TAG_PILL_HEIGHT * TAG_VISIBLE_ROWS + TAG_GAP * (TAG_VISIBLE_ROWS - 1);

/** Matches the entry list: rows get lighter as the image mode gets heavier. */
const WINDOW_SIZE_BY_MODE: Record<ImageMode, number> = {
  hidden: 11,
  small: 9,
  medium: 7,
  large: 3,
};

const IMAGE_MODE_ICON: Record<ImageMode, string> = {
  small: 'image-size-select-small',
  medium: 'image-size-select-large',
  large: 'image-size-select-actual',
  hidden: 'image-off-outline',
};

const nextImageMode = (mode: ImageMode): ImageMode => {
  if (mode === 'small') return 'medium';
  if (mode === 'medium') return 'large';
  if (mode === 'large') return 'hidden';
  return 'small';
};

const SearchByTagScreen: React.FC = () => {
  const router = useRouter();
  const { tags, activities, deleteActivityEntry } = useActivityData();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [imageMode, setImageMode] = useState<ImageMode>('small');

  // Paginated across every selected tag. Previously this fetched the complete
  // entry list for each tag -- images included -- and de-duplicated in JS.
  const { entries, total, loading, loadingMore, hasMore, loadMore, refresh, removeEntry } =
    useEntriesByTags(selectedTagIds);

  const sectionListRef = useRef<SectionList<ListEntry>>(null);
  const pendingRandomIndex = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        void clearImageMemoryCache();
      };
    }, [refresh])
  );

  // A heavier mode re-decodes at a larger size; drop the old bitmaps rather
  // than keeping both generations alive.
  useEffect(() => {
    void clearImageMemoryCache();
  }, [imageMode]);

  const filteredEntries = entries.filter(entry => {
    const activity = activities.find(a => a.id === entry.activityId);
    const searchContent = `${activity?.name || ''} ${entry.notes || ''}`.toLowerCase();
    return searchContent.includes(searchQuery.toLowerCase());
  });

  const groupedEntries = useMemo(() => {
    const groups: { [key: string]: { title: string, data: ListEntry[] } } = {};

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
    removeEntry(entryId);
    await deleteActivityEntry(activityId, entryId);
  };

  /**
   * Entries are grouped by activity, so a position in the flat list is not a
   * position on screen. Find the row by identity instead.
   */
  const scrollToEntry = useCallback(
    (entryId: string) => {
      for (let sectionIndex = 0; sectionIndex < groupedEntries.length; sectionIndex++) {
        const itemIndex = groupedEntries[sectionIndex].data.findIndex(
          entry => entry.id === entryId,
        );
        if (itemIndex >= 0) {
          sectionListRef.current?.scrollToLocation({
            sectionIndex,
            itemIndex,
            animated: false,
            viewPosition: 0,
          });
          return;
        }
      }
    },
    [groupedEntries],
  );

  /**
   * Jump to a random entry among everything the selected tags match, not just
   * what has been paged in — the same as the dice on an activity. The target
   * may not be loaded yet, so the intent is recorded and pages are requested
   * until it arrives.
   *
   * A search is applied in JS after paging, so while one is active `total` no
   * longer describes what is on screen. There the pick comes from the rows
   * actually displayed.
   */
  const handleDicePress = useCallback(() => {
    if (selectedTagIds.length === 0) return;

    if (searchQuery) {
      const displayed = groupedEntries.flatMap(group => group.data);
      if (displayed.length === 0) return;
      scrollToEntry(displayed[Math.floor(Math.random() * displayed.length)].id);
      return;
    }

    if (total === 0) return;
    const randomIndex = Math.floor(Math.random() * total);

    if (randomIndex < entries.length) {
      scrollToEntry(entries[randomIndex].id);
      return;
    }

    pendingRandomIndex.current = randomIndex;
    loadMore();
  }, [entries, groupedEntries, loadMore, scrollToEntry, searchQuery, selectedTagIds.length, total]);

  useEffect(() => {
    const target = pendingRandomIndex.current;
    if (target === null) return;

    if (target < entries.length) {
      pendingRandomIndex.current = null;
      const entryId = entries[target].id;
      // Wait a frame so the newly appended rows have been laid out.
      requestAnimationFrame(() => scrollToEntry(entryId));
    } else if (hasMore && !loadingMore) {
      loadMore();
    } else if (!hasMore) {
      pendingRandomIndex.current = null;
    }
  }, [entries, hasMore, loadingMore, loadMore, scrollToEntry]);

  const hasSelection = selectedTagIds.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <TouchableOpacity onPress={() => router.back()}>
            <Icon name="arrow-left" size={30} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDicePress}
            style={styles.headerButton}
            disabled={!hasSelection}
            accessibilityLabel="Jump to a random entry"
          >
            <Icon
              name="dice-multiple"
              size={30}
              color={hasSelection ? theme.colors.text : theme.colors.disabled}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Search by Tag</Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <TouchableOpacity
            onPress={() => setImageMode(nextImageMode)}
            accessibilityLabel="Change image size"
          >
            <Icon name={IMAGE_MODE_ICON[imageMode] as any} size={30} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/*
        Wraps across the full width rather than running off the side. Capped at
        a few rows so the results below keep their place; the block scrolls
        within that cap when there are more tags than fit.
      */}
      <View style={styles.tagSelector}>
        <ScrollView
          style={{ maxHeight: TAG_BLOCK_MAX_HEIGHT }}
          contentContainerStyle={styles.tagScroll}
          showsVerticalScrollIndicator
        >
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
                <Text style={styles.tagButtonText} numberOfLines={1}>{tag.name}</Text>
                {isSelected && <Icon name="check" size={14} color="#FFFFFF" style={{ marginLeft: 5 }} />}
              </TouchableOpacity>
            );
          })}
          {tags.length === 0 && <Text style={styles.noTagsText}>No tags available. Create some in Settings.</Text>}
        </ScrollView>
      </View>

      {hasSelection && (
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
        ref={sectionListRef}
        sections={groupedEntries}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={imageMode === 'large' ? 3 : 10}
        windowSize={WINDOW_SIZE_BY_MODE[imageMode]}
        maxToRenderPerBatch={imageMode === 'large' ? 2 : 4}
        /*
         * removeClippedSubviews is deliberately off, for the same reason it is
         * off on the entry list: it detaches off-screen cells, a detached cell
         * reports a zero-height layout, and the list records that as the row's
         * real height — so the content shrinks under a scroll in progress and
         * the position is clamped back up the page.
         */
        onScrollToIndexFailed={() => {
          // Rows are not measured yet. The dice already waits a frame; if the
          // target is still unplaced, leave the list where it is rather than
          // scrolling somewhere arbitrary.
        }}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ marginVertical: 20 }} color={theme.colors.primary} />
          ) : null
        }
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.activityLabel}>{title}</Text>
        )}
        renderItem={({ item, index, section }) => {
          const chronologicalNextItem = section.data[index + 1];
          const lastEntryEndDate = chronologicalNextItem ? chronologicalNextItem.endDate : undefined;
          return (
            <ActivityHistoryItem
              entryId={item.id}
              startDate={item.startDate}
              endDate={item.endDate}
              notes={item.notes}
              images={item.images}
              thumbnails={item.thumbnails}
              imageMode={imageMode}
              tags={item.tags}
              lastEntryEndDate={lastEntryEndDate}
              onEdit={() => router.push(`/EditEntry?activityId=${item.activityId}&entryId=${item.id}`)}
              onDelete={() => handleDeleteEntry(item.activityId, item.id)}
            />
          );
        }}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
            <Icon name={hasSelection ? "timer-sand-empty" : "tag-multiple-outline"} size={60} color={theme.colors.disabled} />
            <Text style={styles.emptyText}>
              {hasSelection ? "No entries found for these tags." : "Select one or more tags above to see entries."}
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
  headerSide: {
    flexDirection: 'row',
    alignItems: 'center',
    // Equal on both sides so the title stays centred whatever sits in them.
    minWidth: 70,
  },
  headerSideRight: {
    justifyContent: 'flex-end',
  },
  headerButton: {
    marginLeft: 15,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TAG_GAP,
  },
  tagButton: {
    paddingHorizontal: 15,
    paddingVertical: TAG_PILL_PADDING_VERTICAL,
    borderRadius: 20,
    opacity: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    // Keeps a long tag name from stretching a row taller than the rest.
    maxWidth: '100%',
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
    // Explicit, so every pill is exactly one row tall and the cap above lands
    // where it is meant to.
    lineHeight: TAG_PILL_LINE_HEIGHT,
    flexShrink: 1,
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
