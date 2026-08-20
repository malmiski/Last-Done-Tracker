import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import ActivityHistoryItem, { ImageMode } from '../src/components/ActivityHistoryItem';
import { clearImageMemoryCache } from '../src/components/AppImage';
import { useActivityData } from '../src/hooks/useActivityData';
import { useEntries } from '../src/hooks/useEntries';
import { EntryRow, buildEntryRows } from '../src/utils/entryRows';
import { ROW_METRICS, buildItemLayout, rowContentWidth } from '../src/utils/entryRowLayout';
import { subscribeToDimensions } from '../src/utils/imageDimensions';

/**
 * How many rows are kept mounted around the viewport. Deliberately tight:
 * every mounted row in "large" mode holds a decoded full-size bitmap, so this
 * number multiplied by the image size is the memory ceiling for the screen.
 *
 * "hidden" used to be 21 — ten screens either side. Rows without images are
 * cheap individually, but on web each one is still a handful of DOM nodes, and
 * several hundred of them make every layout pass more expensive. Five screens
 * either side is enough buffer to scroll into without blank space.
 */
const WINDOW_SIZE_BY_MODE: Record<ImageMode, number> = {
  hidden: 11,
  small: 9,
  medium: 7,
  large: 3,
};


const ActivityDetailScreen: React.FC = () => {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { getActivityById, addActivityEntry, deleteActivityEntry } = useActivityData();
  const [imageMode, setImageMode] = useState<ImageMode>('small');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    entries,
    total,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh,
    removeEntry,
  } = useEntries(activityId, { search: searchQuery });

  const flatListRef = useRef<FlatList<EntryRow>>(null);
  const pendingRandomIndex = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Re-reads the rows already loaded rather than collapsing to page one —
      // see the note on `refresh` in useEntries.
      void refresh();
      return () => {
        // Leaving the screen is the natural moment to hand decoded bitmaps
        // back. Without this, browsing several activities in a row ratchets
        // memory upward until something gets killed.
        void clearImageMemoryCache();
      };
    }, [refresh]),
  );

  // Switching to a heavier image mode re-decodes at a larger size; drop the
  // old bitmaps rather than keeping both generations alive.
  useEffect(() => {
    void clearImageMemoryCache();
  }, [imageMode]);

  const activity = getActivityById(activityId);

  /**
   * Jump to a random entry. With pagination the target may not be loaded yet,
   * so we record the intent and keep requesting pages until it arrives.
   */
  const handleDicePress = useCallback(() => {
    if (total === 0) return;
    const randomIndex = Math.floor(Math.random() * total);

    if (randomIndex < entries.length) {
      flatListRef.current?.scrollToIndex({ index: randomIndex, animated: false });
      return;
    }

    pendingRandomIndex.current = randomIndex;
    loadMore();
  }, [entries.length, loadMore, total]);

  useEffect(() => {
    const target = pendingRandomIndex.current;
    if (target === null) return;

    if (target < entries.length) {
      pendingRandomIndex.current = null;
      // Wait a frame so the newly appended rows have been laid out.
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({ index: target, animated: false });
      });
    } else if (hasMore && !loadingMore) {
      loadMore();
    } else if (!hasMore) {
      pendingRandomIndex.current = null;
    }
  }, [entries.length, hasMore, loadingMore, loadMore]);

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
      case 'medium': return 'image-size-select-large';
      case 'large': return 'image-size-select-actual';
      case 'hidden': return 'image-off-outline';
      default: return 'image-size-select-small';
    }
  };

  const handleAddEntry = async () => {
    const now = new Date();
    const newEntryId = await addActivityEntry(activityId, now, now, undefined, undefined, undefined, []);
    router.push(`/EditEntry?activityId=${activityId}&entryId=${newEntryId}`);
  };

  const handleDelete = useCallback(
    async (entryId: string) => {
      removeEntry(entryId);
      await deleteActivityEntry(activityId, entryId);
    },
    [activityId, deleteActivityEntry, removeEntry],
  );

  /*
   * Bumped when image sizes are learned. A large-mode row whose photos have
   * never been measured is laid out at the fallback height; once the gallery
   * measures them and reports back, the row is rebuilt at its true height.
   * That is the single shift a row is allowed — the first time it is ever
   * seen. The notification is batched in imageDimensions, so a fast scroll
   * through unmeasured rows rebuilds the table a few times, not hundreds.
   */
  const [dimensionsVersion, setDimensionsVersion] = useState(0);
  useEffect(
    () => subscribeToDimensions(() => setDimensionsVersion(version => version + 1)),
    [],
  );

  const contentWidth = rowContentWidth(useWindowDimensions().width);

  const rows = useMemo<EntryRow[]>(
    () => buildEntryRows(entries, total),
    // dimensionsVersion is not read here: it is a signal that the sizes the
    // builder looks up have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, total, dimensionsVersion],
  );

  /*
   * Tells the list exactly where every row sits, so it never has to render a
   * row to find out how tall it is and then correct itself afterwards. Those
   * corrections are what moved the content mid-scroll, and when a correction
   * changed which rows were inside the render window it could settle into a
   * loop — the screen shaking until a scroll broke the cycle.
   *
   * There is always a table. A large-mode row whose photos have never been
   * measured is reserved the fallback gallery height and drawn at exactly that
   * height, then corrected once when the measurement arrives. Handing the list
   * a table on some renders and nothing on others was far worse than a rough
   * number: it left the list unable to reconcile its frames at all.
   */
  const getItemLayout = useMemo(
    () => buildItemLayout(rows, imageMode, contentWidth),
    [rows, imageMode, contentWidth],
  );

  /*
   * Depends only on things that change when the user acts, not on `entries`.
   * When it depended on the array, every loaded page gave the callback a new
   * identity and made the list re-render every mounted cell — work that lands
   * in the middle of a scroll, which is when it is least affordable.
   */
  const renderItem = useCallback(
    ({ item }: { item: EntryRow }) => (
      <ActivityHistoryItem
        entryId={item.entry.id}
        index={item.displayIndex}
        startDate={item.entry.startDate}
        endDate={item.entry.endDate}
        notes={item.entry.notes}
        images={item.entry.images}
        thumbnails={item.entry.thumbnails}
        imageMode={imageMode}
        tags={item.entry.tags}
        lastEntryEndDate={item.previousEndDate}
        onEdit={() => router.push(`/EditEntry?activityId=${activityId}&entryId=${item.entry.id}`)}
        onDelete={() => handleDelete(item.entry.id)}
      />
    ),
    [activityId, handleDelete, imageMode, router],
  );

  /*
   * onEndReached fires on every scroll event once the threshold is crossed,
   * and the list keeps firing it while a page is still in flight. Each page
   * that lands grows the content, which moves the threshold, which fires it
   * again — a feedback loop that appends pages faster than the user scrolls.
   */
  const handleEndReached = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    loadMore();
  }, [hasMore, loading, loadingMore, loadMore]);

  if (!activity) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Activity not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/Activities"); } }}>
            <Icon name="arrow-left" size={30} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDicePress} style={{ marginLeft: 15 }}>
            <Icon name="dice-multiple" size={30} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
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
        ref={flatListRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={row => row.entry.id}
        contentContainerStyle={styles.listContent}
        // Pagination: the next page is fetched as the user approaches the end
        // rather than loading the whole history up front.
        getItemLayout={getItemLayout}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        // Windowing. These are the numbers that bound how many images can be
        // decoded at once, so they tighten as the image mode gets heavier.
        windowSize={WINDOW_SIZE_BY_MODE[imageMode]}
        initialNumToRender={imageMode === 'large' ? 3 : 10}
        // Smaller batches, same cadence: the work of laying out new rows is
        // spread across more frames instead of landing in one long one.
        maxToRenderPerBatch={imageMode === 'large' ? 2 : 4}
        updateCellsBatchingPeriod={50}
        scrollEventThrottle={16}
        /*
         * removeClippedSubviews is deliberately off.
         *
         * It detaches off-screen cells from the view hierarchy, and a detached
         * cell reports a zero-height layout. VirtualizedList records that as
         * the row's real height, so the total content height shrinks while you
         * are scrolling; the scroll position then gets clamped to the new,
         * shorter content and you are thrown back up the page. That is the
         * "scrolling down jumps me up" symptom, and it happens in every image
         * mode because it has nothing to do with images.
         *
         * windowSize above already bounds how many rows stay mounted, which is
         * the memory guarantee this was reached for in the first place.
         */
        /*
         * A constant-height footer whether or not a page is loading. When the
         * spinner appeared and disappeared, the content height changed by its
         * height each time — right at the bottom of the list, which is exactly
         * where the end-reached threshold lives, so one load could nudge the
         * list into triggering the next.
         */
        ListFooterComponent={
          <View style={styles.footer}>
            {loadingMore ? <ActivityIndicator color={theme.colors.primary} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.footerSpinner} color={theme.colors.primary} />
          ) : (
            <Text style={styles.emptyText}>
              {searchQuery ? 'No entries match your search.' : 'No entries yet.'}
            </Text>
          )
        }
        onScrollToIndexFailed={info => {
          // With getItemLayout unavailable (rows vary in height), fall back to
          // an estimated offset and let the list settle.
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
        }}
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
    // Mirrored in ROW_METRICS.listPaddingTop, which getItemLayout adds to the
    // first row's offset.
    paddingTop: ROW_METRICS.listPaddingTop,
    paddingBottom: 100,
  },
  footer: {
    height: 60,
    justifyContent: 'center',
  },
  footerSpinner: {
    marginVertical: 20,
  },
  emptyText: {
    color: theme.colors.subtext,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
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
