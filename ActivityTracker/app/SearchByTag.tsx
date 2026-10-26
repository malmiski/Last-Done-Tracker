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
import ScrollHudButtons, { animateScrollOffset, JUMP_SCROLL_DURATION_MS } from '../src/components/ScrollHudButtons';
import { clearImageMemoryCache } from '../src/components/AppImage';

/**
 * The tag block is a fixed number of rows tall and overflows sideways.
 *
 * The pills are laid out in columns — top to bottom, then wrapping into the
 * next column — inside a horizontal scroller. That is the only arrangement
 * that keeps the block's height fixed while letting every tag show its full
 * name: wrapping into rows instead would make the height depend on how many
 * tags there are and how long their names run, and the results below would
 * move every time the tag list changed.
 *
 * Heights are computed from the pill's own metrics rather than guessed, and
 * the pill text declares an explicit lineHeight, so a row is exactly one line
 * tall on every platform.
 */
const TAG_PILL_PADDING_VERTICAL = 8;
const TAG_PILL_LINE_HEIGHT = 18;
const TAG_PILL_BORDER_WIDTH = 2;
const TAG_PILL_HEIGHT =
  TAG_PILL_LINE_HEIGHT + TAG_PILL_PADDING_VERTICAL * 2 + TAG_PILL_BORDER_WIDTH * 2;
const TAG_GAP = 10;
const TAG_MAX_ROWS = 5;

/**
 * Roughly how many columns to aim for before adding another row.
 *
 * Without this the block would always be its full height, and an account with
 * three tags would show them stacked in a single tall column rather than side
 * by side. Choosing the row count from the number of tags keeps a short list
 * looking like a strip and only builds upward once there is enough to fill it.
 */
const TAG_COLUMNS_TARGET = 4;

const tagRowCount = (tagCount: number): number =>
  Math.min(TAG_MAX_ROWS, Math.max(1, Math.ceil(tagCount / TAG_COLUMNS_TARGET)));

const tagBlockHeight = (tagCount: number): number => {
  const rows = tagRowCount(tagCount);
  return TAG_PILL_HEIGHT * rows + TAG_GAP * (rows - 1);
};

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
  const {
    entries,
    total,
    windowOffset,
    loading,
    loadingMore,
    loadingPrevious,
    hasMore,
    hasPrevious,
    loadMore,
    loadPrevious,
    jumpToBottom,
    jumpToTop,
    refresh,
    removeEntry,
  } = useEntriesByTags(selectedTagIds);

  const sectionListRef = useRef<SectionList<ListEntry>>(null);
  const pendingRandomIndex = useRef<number | null>(null);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(800);
  const listHeightRef = useRef(600);
  const isJumpingRef = useRef(false);
  const [pendingJump, setPendingJump] = useState<{ edge: 'top' | 'bottom'; id: number } | null>(null);
  const lastHandledJumpIdRef = useRef(0);

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

  const scrollSectionListToOffset = useCallback((y: number, animated: boolean) => {
    const responder = (sectionListRef.current as any)?.getScrollResponder?.();
    if (responder?.scrollTo) {
      responder.scrollTo({ y, animated });
    } else if ((sectionListRef.current as any)?._wrapperListRef?.getListRef) {
      (sectionListRef.current as any)._wrapperListRef
        .getListRef()
        .scrollToOffset({ offset: y, animated });
    }
  }, []);

  const getMaxScrollOffset = useCallback(
    () => Math.max(0, contentHeightRef.current - listHeightRef.current),
    [],
  );

  useEffect(() => {
    if (!pendingJump || pendingJump.id === lastHandledJumpIdRef.current || groupedEntries.length === 0) {
      return;
    }
    lastHandledJumpIdRef.current = pendingJump.id;
    const edge = pendingJump.edge;
    setPendingJump(null);

    let cancelled = false;
    const runLanding = async () => {
      try {
        const maxY = Math.max(400, getMaxScrollOffset());
        const runway = Math.max(listHeightRef.current * 2.5, 1600);
        if (edge === 'bottom') {
          const startY = Math.max(0, maxY - runway);
          scrollOffsetRef.current = startY;
          scrollSectionListToOffset(startY, false);
          await animateScrollOffset(
            y => {
              if (!cancelled) {
                scrollOffsetRef.current = y;
                scrollSectionListToOffset(y, false);
              }
            },
            startY,
            () => Math.max(startY, getMaxScrollOffset()),
            JUMP_SCROLL_DURATION_MS,
          );
        } else {
          const startY = Math.min(maxY, runway);
          scrollOffsetRef.current = startY;
          scrollSectionListToOffset(startY, false);
          await animateScrollOffset(
            y => {
              if (!cancelled) {
                scrollOffsetRef.current = y;
                scrollSectionListToOffset(y, false);
              }
            },
            startY,
            0,
            JUMP_SCROLL_DURATION_MS,
          );
        }
      } finally {
        if (!cancelled) {
          isJumpingRef.current = false;
        }
      }
    };
    void runLanding();

    return () => {
      cancelled = true;
    };
  }, [pendingJump, groupedEntries, getMaxScrollOffset, scrollSectionListToOffset]);

  const handleScrollToTop = useCallback(async () => {
    if (groupedEntries.length === 0 || isJumpingRef.current) return;

    if (windowOffset > 0 && !searchQuery) {
      isJumpingRef.current = true;
      await jumpToTop();
      setPendingJump({ edge: 'top', id: Date.now() });
      return;
    }

    const startY = scrollOffsetRef.current;
    if (startY <= 1) {
      scrollSectionListToOffset(0, false);
      return;
    }
    isJumpingRef.current = true;
    try {
      const runway = Math.max(listHeightRef.current * 2.5, 1600);
      const launchY = Math.min(startY, runway);
      if (launchY < startY) {
        scrollOffsetRef.current = launchY;
        scrollSectionListToOffset(launchY, false);
      }
      await animateScrollOffset(
        y => {
          scrollOffsetRef.current = y;
          scrollSectionListToOffset(y, false);
        },
        launchY,
        0,
        JUMP_SCROLL_DURATION_MS,
      );
    } finally {
      isJumpingRef.current = false;
    }
  }, [groupedEntries.length, jumpToTop, scrollSectionListToOffset, searchQuery, windowOffset]);

  const handleScrollToBottom = useCallback(async () => {
    if (groupedEntries.length === 0 || isJumpingRef.current) return;

    if (hasMore && !searchQuery) {
      isJumpingRef.current = true;
      await jumpToBottom();
      setPendingJump({ edge: 'bottom', id: Date.now() });
      return;
    }

    const targetY = getMaxScrollOffset();
    const startY = scrollOffsetRef.current;
    if (Math.abs(targetY - startY) <= 1) {
      return;
    }
    isJumpingRef.current = true;
    try {
      const runway = Math.max(listHeightRef.current * 2.5, 1600);
      const launchY = Math.max(startY, targetY - runway);
      if (launchY > startY) {
        scrollOffsetRef.current = launchY;
        scrollSectionListToOffset(launchY, false);
      }
      await animateScrollOffset(
        y => {
          scrollOffsetRef.current = y;
          scrollSectionListToOffset(y, false);
        },
        launchY,
        getMaxScrollOffset,
        JUMP_SCROLL_DURATION_MS,
      );
    } finally {
      isJumpingRef.current = false;
    }
  }, [getMaxScrollOffset, groupedEntries.length, hasMore, jumpToBottom, scrollSectionListToOffset, searchQuery]);

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

    if (randomIndex >= windowOffset && randomIndex < windowOffset + entries.length) {
      scrollToEntry(entries[randomIndex - windowOffset].id);
      return;
    }

    pendingRandomIndex.current = randomIndex;
    if (randomIndex < windowOffset) {
      loadPrevious();
    } else {
      loadMore();
    }
  }, [entries, groupedEntries, loadMore, loadPrevious, scrollToEntry, searchQuery, selectedTagIds.length, total, windowOffset]);

  useEffect(() => {
    const target = pendingRandomIndex.current;
    if (target === null) return;

    if (target >= windowOffset && target < windowOffset + entries.length) {
      pendingRandomIndex.current = null;
      const entryId = entries[target - windowOffset].id;
      // Wait a frame so the newly appended rows have been laid out.
      requestAnimationFrame(() => scrollToEntry(entryId));
    } else if (target < windowOffset && hasPrevious && !loadingPrevious) {
      loadPrevious();
    } else if (target >= windowOffset + entries.length && hasMore && !loadingMore) {
      loadMore();
    } else if (!hasMore && !hasPrevious) {
      pendingRandomIndex.current = null;
    }
  }, [entries, hasMore, hasPrevious, loadingMore, loadingPrevious, loadMore, loadPrevious, scrollToEntry, windowOffset]);

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
        A fixed-height grid that scrolls sideways: every tag shows its full
        name, and the height never changes, so the results below always start
        in the same place.
      */}
      <View style={styles.tagSelector}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={[styles.tagScroll, { height: tagBlockHeight(tags.length) }]}
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
                <Text style={styles.tagButtonText}>{tag.name}</Text>
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
        onEndReached={() => {
          if (!isJumpingRef.current) loadMore();
        }}
        onEndReachedThreshold={0.5}
        onScroll={e => {
          const y = e.nativeEvent.contentOffset.y;
          scrollOffsetRef.current = y;
          if (!isJumpingRef.current && hasPrevious && !loadingPrevious && y < listHeightRef.current * 0.8) {
            loadPrevious();
          }
        }}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
        }}
        onLayout={e => {
          listHeightRef.current = e.nativeEvent.layout.height;
        }}
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

      <ScrollHudButtons
        onPressTop={handleScrollToTop}
        onPressBottom={handleScrollToBottom}
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
    // Column direction plus wrap is what fills downward and then spills into
    // the next column, which is what makes the height fixed and the overflow
    // horizontal. alignContent keeps the columns packed to the left instead of
    // spreading across whatever width the scroller reports.
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: TAG_GAP,
  },
  tagButton: {
    paddingHorizontal: 15,
    paddingVertical: TAG_PILL_PADDING_VERTICAL,
    borderRadius: 20,
    borderWidth: TAG_PILL_BORDER_WIDTH,
    borderColor: 'transparent',
    opacity: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    // No width cap: a tag shows its whole name and the block scrolls instead.
    alignSelf: 'flex-start',
  },
  selectedTagButton: {
    opacity: 1,
    borderColor: theme.colors.text,
  },
  tagButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
    // Explicit, so every pill is exactly one row tall and the block height
    // computed above is the height actually drawn.
    lineHeight: TAG_PILL_LINE_HEIGHT,
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
    paddingBottom: 110,
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
