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
  Modal,
  ScrollView,
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
import { getAvailableTagCounts } from '../src/utils/database';

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
  const { getActivityById, addActivityEntry, deleteActivityEntry, tags: allTags } = useActivityData();
  const [imageMode, setImageMode] = useState<ImageMode>('small');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter states
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [filterStartDate, setFilterStartDate] = useState<number | undefined>();
  const [filterEndDate, setFilterEndDate] = useState<number | undefined>();
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterTagMode, setFilterTagMode] = useState<'AND' | 'OR'>('OR');

  // Filter UI states
  const [fYear, setFYear] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fDay, setFDay] = useState('');
  const [fHour, setFHour] = useState('');
  const [fMinute, setFMinute] = useState('');
  const [fAmpm, setFAmpm] = useState('AM');

  const [fEndYear, setFEndYear] = useState('');
  const [fEndMonth, setFEndMonth] = useState('');
  const [fEndDay, setFEndDay] = useState('');
  const [fEndHour, setFEndHour] = useState('');
  const [fEndMinute, setFEndMinute] = useState('');
  const [fEndAmpm, setFEndAmpm] = useState('PM');


  const [fSelectedTagIds, setFSelectedTagIds] = useState<string[]>([]);
  const [fTagMode, setFTagMode] = useState<'AND' | 'OR'>('OR');
  const [dynamicTagCounts, setDynamicTagCounts] = useState<Record<string, number>>({});


  // Sync applied filters to UI state when modal opens

  const openFilterModal = () => {
    if (filterStartDate) {
      const start = new Date(filterStartDate);
      setFYear(start.getFullYear().toString());
      setFMonth((start.getMonth() + 1).toString());
      setFDay(start.getDate().toString());
      let hours = start.getHours();
      setFAmpm(hours >= 12 ? 'PM' : 'AM');
      hours = hours % 12;
      hours = hours ? hours : 12;
      setFHour(hours.toString());
      setFMinute(start.getMinutes().toString().padStart(2, '0'));
    } else {
      setFYear(''); setFMonth(''); setFDay(''); setFHour(''); setFMinute(''); setFAmpm('AM');
    }

    if (filterEndDate) {
      const end = new Date(filterEndDate);
      setFEndYear(end.getFullYear().toString());
      setFEndMonth((end.getMonth() + 1).toString());
      setFEndDay(end.getDate().toString());
      let hours = end.getHours();
      setFEndAmpm(hours >= 12 ? 'PM' : 'AM');
      hours = hours % 12;
      hours = hours ? hours : 12;
      setFEndHour(hours.toString());
      setFEndMinute(end.getMinutes().toString().padStart(2, '0'));
    } else {
      setFEndYear(''); setFEndMonth(''); setFEndDay(''); setFEndHour(''); setFEndMinute(''); setFEndAmpm('PM');
    }

    setFSelectedTagIds(filterTagIds);
    setFTagMode(filterTagMode);
    setIsFilterModalVisible(true);
  };

  const getFullDate = (y: string, m: string, d: string, h: string, min: string, ampmVal: string) => {
    if (!y && !m && !d && !h && !min) return undefined;

    let hours = h ? parseInt(h, 10) : 0;
    if (ampmVal.toUpperCase() === 'PM' && hours > 0 && hours < 12) hours += 12;
    if (ampmVal.toUpperCase() === 'AM' && hours === 12) hours = 0;

    const parsedY = y ? parseInt(y, 10) : 0;
    const parsedM = m ? parseInt(m, 10) - 1 : 0; // JS months are 0-indexed
    const parsedD = d ? parseInt(d, 10) : 1;
    const parsedMin = min ? parseInt(min, 10) : 0;

    return new Date(parsedY, parsedM, parsedD, hours, parsedMin, 0).getTime();
  };

  useEffect(() => {
    if (isFilterModalVisible && activityId) {
      const start = getFullDate(fYear, fMonth, fDay, fHour, fMinute, fAmpm);
      const end = getFullDate(fEndYear, fEndMonth, fEndDay, fEndHour, fEndMinute, fEndAmpm);
      getAvailableTagCounts(activityId, searchQuery, start, end, fSelectedTagIds, fTagMode).then(setDynamicTagCounts);
    }
  }, [isFilterModalVisible, activityId, searchQuery, fYear, fMonth, fDay, fHour, fMinute, fAmpm, fEndYear, fEndMonth, fEndDay, fEndHour, fEndMinute, fEndAmpm, fSelectedTagIds, fTagMode]);

  const applyFilters = () => {
    const start = getFullDate(fYear, fMonth, fDay, fHour, fMinute, fAmpm);
    const end = getFullDate(fEndYear, fEndMonth, fEndDay, fEndHour, fEndMinute, fEndAmpm);

    setFilterStartDate(start);
    setFilterEndDate(end);
    setFilterTagIds(fSelectedTagIds);
    setFilterTagMode(fTagMode);
    setIsFilterModalVisible(false);
  };

  const clearFilters = () => {
    setFilterStartDate(undefined);
    setFilterEndDate(undefined);
    setFilterTagIds([]);
    setFilterTagMode('OR');
    setIsFilterModalVisible(false);
  };

  const toggleTag = (tagId: string) => {
    setFSelectedTagIds(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  };

  const {
    entries,
    total,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh,
    removeEntry,
  } = useEntries(activityId, { search: searchQuery, filterStartDate, filterEndDate, filterTagIds, filterTagMode });

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



  const viewableItemsRef = useRef<Array<any>>([]);
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 10 });
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<any> }) => {
    viewableItemsRef.current = viewableItems;
  }, []);

  const cycleImageMode = () => {
    const topItem = viewableItemsRef.current.find(item => item.isViewable) || viewableItemsRef.current[0];
    const topIndex = topItem ? topItem.index : 0;

    let nextMode: ImageMode = 'small';
    if (imageMode === 'small') nextMode = 'medium';
    else if (imageMode === 'medium') nextMode = 'large';
    else if (imageMode === 'large') nextMode = 'hidden';

    setImageMode(nextMode);

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (flatListRef.current && topIndex != null) {
          flatListRef.current.scrollToIndex({ index: topIndex, animated: false, viewPosition: 0 });
        }
      }, 50);
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
        <TouchableOpacity onPress={openFilterModal} style={styles.filterIcon} testID="filter-button">
          <Icon name="filter-variant" size={24} color={(filterStartDate || filterEndDate || filterTagIds.length > 0) ? theme.colors.primary : theme.colors.text} />
        </TouchableOpacity>
      </View>

      <Modal visible={isFilterModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsFilterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={styles.modalTitle}>Filter Entries</Text>

              <Text style={styles.sectionLabel}>Start After</Text>
              <View style={styles.inputRow}>
                <TextInput style={styles.input} placeholder="MM" value={fMonth} onChangeText={setFMonth} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>/</Text>
                <TextInput style={styles.input} placeholder="DD" value={fDay} onChangeText={setFDay} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>/</Text>
                <TextInput style={[styles.input, {width: 80}]} placeholder="YYYY" value={fYear} onChangeText={setFYear} keyboardType="number-pad" maxLength={4} />
              </View>
              <View style={[styles.inputRow, { zIndex: 100 }]}>
                <TextInput style={styles.input} placeholder="HH" value={fHour} onChangeText={setFHour} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>:</Text>
                <TextInput style={styles.input} placeholder="MM" value={fMinute} onChangeText={setFMinute} keyboardType="number-pad" maxLength={2} />
                <View style={styles.ampmContainer}>
                    <TouchableOpacity style={[styles.ampmButton, fAmpm === 'AM' && styles.ampmButtonActive]} onPress={() => setFAmpm('AM')}>
                        <Text style={[styles.ampmText, fAmpm === 'AM' && styles.ampmTextActive]}>AM</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.ampmButton, fAmpm === 'PM' && styles.ampmButtonActive]} onPress={() => setFAmpm('PM')}>
                        <Text style={[styles.ampmText, fAmpm === 'PM' && styles.ampmTextActive]}>PM</Text>
                    </TouchableOpacity>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>End Before</Text>
              <View style={styles.inputRow}>
                <TextInput style={styles.input} placeholder="MM" value={fEndMonth} onChangeText={setFEndMonth} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>/</Text>
                <TextInput style={styles.input} placeholder="DD" value={fEndDay} onChangeText={setFEndDay} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>/</Text>
                <TextInput style={[styles.input, {width: 80}]} placeholder="YYYY" value={fEndYear} onChangeText={setFEndYear} keyboardType="number-pad" maxLength={4} />
              </View>
              <View style={[styles.inputRow, { zIndex: 50 }]}>
                <TextInput style={styles.input} placeholder="HH" value={fEndHour} onChangeText={setFEndHour} keyboardType="number-pad" maxLength={2} />
                <Text style={styles.separator}>:</Text>
                <TextInput style={styles.input} placeholder="MM" value={fEndMinute} onChangeText={setFEndMinute} keyboardType="number-pad" maxLength={2} />
                <View style={styles.ampmContainer}>
                    <TouchableOpacity style={[styles.ampmButton, fEndAmpm === 'AM' && styles.ampmButtonActive]} onPress={() => setFEndAmpm('AM')}>
                        <Text style={[styles.ampmText, fEndAmpm === 'AM' && styles.ampmTextActive]}>AM</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.ampmButton, fEndAmpm === 'PM' && styles.ampmButtonActive]} onPress={() => setFEndAmpm('PM')}>
                        <Text style={[styles.ampmText, fEndAmpm === 'PM' && styles.ampmTextActive]}>PM</Text>
                    </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.sectionHeaderRow, { marginTop: 20, marginBottom: 10 }]}>
                <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Filter Tags</Text>
                <View style={styles.tagModeToggle}>
                  <TouchableOpacity style={[styles.tagModeButton, fTagMode === 'OR' && styles.tagModeButtonActive]} onPress={() => setFTagMode('OR')}>
                    <Text style={[styles.tagModeText, fTagMode === 'OR' && styles.tagModeTextActive]}>Match ANY</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.tagModeButton, fTagMode === 'AND' && styles.tagModeButtonActive]} onPress={() => setFTagMode('AND')}>
                    <Text style={[styles.tagModeText, fTagMode === 'AND' && styles.tagModeTextActive]}>Match ALL</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.tagGrid}>
                {(allTags || []).map(tag => {
                  const isSelected = fSelectedTagIds.includes(tag.id);
                  const count = dynamicTagCounts[tag.id] ?? 0;
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[
                        styles.tagPill,
                        { backgroundColor: tag.color },
                        isSelected && styles.tagPillSelected
                      ]}
                      onPress={() => toggleTag(tag.id)}
                    >
                      <Text style={styles.tagPillText}>{tag.name} ({count})</Text>
                      {isSelected && <Icon name="check" size={14} color="#FFFFFF" style={{ marginLeft: 5 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={clearFilters}>
                <Text style={styles.modalButtonCancelText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={applyFilters}>
                <Text style={styles.modalButtonText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        ref={flatListRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={row => row.entry.id}
        contentContainerStyle={styles.listContent}
        // Pagination: the next page is fetched as the user approaches the end
        // rather than loading the whole history up front.
        getItemLayout={getItemLayout}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfigRef.current}
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
  filterIcon: {
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    padding: 20,
  },
  modalScroll: {
    paddingBottom: 20,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionLabel: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  input: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    width: 60,
    textAlign: 'center',
  },
  separator: {
    color: theme.colors.subtext,
    fontSize: 20,
    marginHorizontal: 5,
  },
  ampmContainer: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderRadius: 8,
    overflow: 'hidden',
    marginLeft: 10,
  },
  ampmButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  ampmButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  ampmText: {
    color: theme.colors.subtext,
    fontSize: 14,
    fontWeight: 'bold',
  },
  ampmTextActive: {
    color: theme.colors.background,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tagModeToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tagModeButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  tagModeButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  tagModeText: {
    color: theme.colors.subtext,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tagModeTextActive: {
    color: theme.colors.background,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    opacity: 0.6,
  },
  tagPillSelected: {
    opacity: 1,
    borderWidth: 2,
    borderColor: theme.colors.text,
  },
  tagPillText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginLeft: 10,
  },
  modalButtonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginLeft: 0,
    marginRight: 10,
  },
  modalButtonText: {
    color: theme.colors.background,
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalButtonCancelText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: 'bold',
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
