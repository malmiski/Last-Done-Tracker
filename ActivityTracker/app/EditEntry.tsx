import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import { useEntry } from '../src/hooks/useEntries';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Tag } from '../src/data/activity-details';
import { importImage, importBase64Image } from '../src/utils/imageUtils';
import * as imageStore from '../src/utils/imageStore';
import { deleteUnreferencedRefs } from '../src/utils/imageOwnership';
import {
  copyEntryToClipboard,
  mergeImageRefs,
  mergeTags,
  readEntryFromClipboard,
  resolveAvailableImages,
} from '../src/utils/entryClipboard';
import AppImage, { clearImageMemoryCache } from '../src/components/AppImage';
import LargeImageGallery from '../src/components/LargeImageGallery';
import Toast, { useToast } from '../src/components/Toast';

/** A photo row in the editor. Holds a reference, never image data. */
interface PhotoDraft {
  ref: string;
  orderStr: string;
}

const EditEntryScreen: React.FC = () => {
  const router = useRouter();
  const { activityId, entryId } = useLocalSearchParams<{ activityId: string, entryId: string }>();
  const { updateActivityEntry, getActivityById, tags, addTag } = useActivityData();

  const activity = getActivityById(activityId);
  // Loads exactly one row. Previously this screen pulled the entire database
  // (every entry of every activity, base64 included) just to find one entry --
  // which is why editing an image-heavy entry was the reliable way to crash.
  const { entry, loading: entryLoading } = useEntry(entryId);

  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [second, setSecond] = useState('');
  const [ampm, setAmpm] = useState('');

  const [endYear, setEndYear] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [endDay, setEndDay] = useState('');
  const [endHour, setEndHour] = useState('');
  const [endMinute, setEndMinute] = useState('');
  const [endSecond, setEndSecond] = useState('');
  const [endAmpm, setEndAmpm] = useState('');

  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [importing, setImporting] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Copy and paste change nothing visible on their own, so they confirm
  // themselves with a brief pill under the header buttons.
  const { toast, showToast, hideToast } = useToast();
  /**
   * References the entry started with. Anything here that is gone at save time
   * has been removed by the user, so its blob is deleted. Without this the
   * files would linger until the next garbage-collection sweep.
   */
  const originalRefs = useRef<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [isFormValidState, setIsFormValidState] = useState(false);
  const [startAmpmDropdownVisible, setStartAmpmDropdownVisible] = useState(false);
  const [endAmpmDropdownVisible, setEndAmpmDropdownVisible] = useState(false);

  const filteredAvailableTags = tags.filter(tag =>
    !selectedTags.find(t => t.id === tag.id) &&
    tag.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  // For new tag creation
  const [newTagModalVisible, setNewTagModalVisible] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#34C759');

  const tagColors = [
    '#34C759', '#FF3B30', '#007AFF', '#FF9500', '#AF52DE',
    '#5856D6', '#FFCC00', '#FF2D55', '#5AC8FA', '#8E8E93'
  ];

  const isFormValid = () => {
    const validate = (y, m, d, h, min, s, ampmVal) => {
        const numMonth = parseInt(m, 10);
        const numDay = parseInt(d, 10);
        const numYear = parseInt(y, 10);
        const numHour = parseInt(h, 10);
        const numMinute = parseInt(min, 10);
        const numSecond = parseInt(s, 10);

        const isMonthValid = !isNaN(numMonth) && numMonth >= 1 && numMonth <= 12;
        const isDayValid = !isNaN(numMonth) && !isNaN(numDay) && !isNaN(numYear) &&
                        numMonth >= 1 && numMonth <= 12 &&
                        numDay >= 1 && numDay <= new Date(numYear, numMonth, 0).getDate();
        const isYearValid = !isNaN(numYear) && numYear > 0;
        const isHourValid = !isNaN(numHour) && numHour >= 1 && numHour <= 12;
        const isMinuteValid = !isNaN(numMinute) && numMinute >= 0 && numMinute <= 59;
        const isSecondValid = !isNaN(numSecond) && numSecond >= 0 && numSecond <= 59;
        const isAmpmValid = ampmVal.toUpperCase() === 'AM' || ampmVal.toUpperCase() === 'PM';

        return isMonthValid && isDayValid && isYearValid && isHourValid && isMinuteValid && isSecondValid && isAmpmValid;
    };

    const startValid = validate(year, month, day, hour, minute, second, ampm);
    const endValid = validate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);

    if (!startValid || !endValid) return false;

    // Check that end date is not before start date
    const getFullDate = (y, m, d, h, min, s, ampmVal) => {
        let hours = parseInt(h, 10);
        if (ampmVal.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (ampmVal.toUpperCase() === 'AM' && hours === 12) hours = 0;
        return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hours, parseInt(min, 10), parseInt(s, 10));
    };

    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);

    return end >= start;
  };


  useEffect(() => {
    if (entry) {
      const entryDate = new Date(entry.startDate);
      setYear(entryDate.getFullYear().toString());
      setMonth((entryDate.getMonth() + 1).toString());
      setDay(entryDate.getDate().toString());
      let hours = entryDate.getHours();
      const ampmVal = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      setHour(hours.toString());
      setMinute(entryDate.getMinutes().toString().padStart(2, '0'));
      setSecond(entryDate.getSeconds().toString().padStart(2, '0'));
      setAmpm(ampmVal);

      const endDate = new Date(entry.endDate);
      setEndYear(endDate.getFullYear().toString());
      setEndMonth((endDate.getMonth() + 1).toString());
      setEndDay(endDate.getDate().toString());
      let endHours = endDate.getHours();
      const endAmpmVal = endHours >= 12 ? 'PM' : 'AM';
      endHours = endHours % 12;
      endHours = endHours ? endHours : 12;
      setEndHour(endHours.toString());
      setEndMinute(endDate.getMinutes().toString().padStart(2, '0'));
      setEndSecond(endDate.getSeconds().toString().padStart(2, '0'));
      setEndAmpm(endAmpmVal);

      setNotes(entry.notes || '');

      const refs = entry.images && entry.images.length > 0 ? entry.images : entry.thumbnails || [];
      originalRefs.current = refs.filter(ref => ref.startsWith('img:'));
      setPhotos(refs.map((ref, index) => ({ ref, orderStr: (index + 1).toString() })));
      setSelectedTags(entry.tags || []);
    }
  }, [entry]);

  useEffect(() => {
    setIsFormValidState(isFormValid());
  }, [year, month, day, hour, minute, second, ampm, endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm]);

  /**
   * Import an image and swap in its reference.
   *
   * The picker's original file is handed straight to the image store, which
   * downscales and writes it to disk. The full-resolution bytes never enter
   * JS, so adding a 12MP photo costs the same as adding a small one.
   */
  const handleImageInput = async (uri: string, replaceIndex: number = -1) => {
    try {
      const stored = await importImage(uri);
      setPhotos(prev => {
          const newPhotos = [...prev];
          if (replaceIndex >= 0 && replaceIndex < newPhotos.length) {
              newPhotos[replaceIndex] = { ...newPhotos[replaceIndex], ref: stored.ref };
          } else {
              newPhotos.push({ ref: stored.ref, orderStr: (newPhotos.length + 1).toString() });
          }
          return newPhotos;
      });
    } catch (e) {
      Alert.alert("Error processing image");
      console.error(e);
    }
  };

  const pickImage = async (replaceIndex: number = -1) => {
    const isMultiple = replaceIndex === -1;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: !isMultiple,
      allowsMultipleSelection: isMultiple,
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImporting(true);
      try {
        if (isMultiple) {
          // Sequential, not Promise.all: parallel decodes of several 12MP
          // photos is exactly the spike we are trying to avoid.
          for (const asset of result.assets) {
            if (asset.uri) {
              await handleImageInput(asset.uri, -1);
            }
          }
        } else {
          await handleImageInput(result.assets[0].uri, replaceIndex);
        }
      } finally {
        setImporting(false);
      }
    }
  };

  const pasteImage = async (replaceIndex: number = -1) => {
    const hasImage = await Clipboard.hasImageAsync();
    if (!hasImage) {
      Alert.alert("No image found in clipboard");
      return;
    }

    setImporting(true);
    try {
      const clipboardImage = await Clipboard.getImageAsync({ format: 'png' });
      if (clipboardImage && clipboardImage.data) {
        const stored = await importBase64Image(clipboardImage.data, 'image/png');
        setPhotos(prev => {
          const newPhotos = [...prev];
          if (replaceIndex >= 0 && replaceIndex < newPhotos.length) {
            newPhotos[replaceIndex] = { ...newPhotos[replaceIndex], ref: stored.ref };
          } else {
            newPhotos.push({ ref: stored.ref, orderStr: (newPhotos.length + 1).toString() });
          }
          return newPhotos;
        });
      }
    } catch (e) {
      Alert.alert("Error processing image");
      console.error(e);
    } finally {
      setImporting(false);
    }
  };

  const getFullDate = (y, m, d, h, min, s, ampmVal) => {
    let hours = parseInt(h, 10);
    if (ampmVal.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (ampmVal.toUpperCase() === 'AM' && hours === 12) hours = 0;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hours, parseInt(min, 10), parseInt(s, 10));
  };

  const updateStartStates = (date: Date) => {
    setYear(date.getFullYear().toString());
    setMonth((date.getMonth() + 1).toString());
    setDay(date.getDate().toString());
    let hours = date.getHours();
    const ampmVal = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    setHour(hours.toString());
    setMinute(date.getMinutes().toString().padStart(2, '0'));
    setSecond(date.getSeconds().toString().padStart(2, '0'));
    setAmpm(ampmVal);
  };

  const updateEndStates = (date: Date) => {
    setEndYear(date.getFullYear().toString());
    setEndMonth((date.getMonth() + 1).toString());
    setEndDay(date.getDate().toString());
    let hours = date.getHours();
    const endAmpmVal = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    setEndHour(hours.toString());
    setEndMinute(date.getMinutes().toString().padStart(2, '0'));
    setEndSecond(date.getSeconds().toString().padStart(2, '0'));
    setEndAmpm(endAmpmVal);
  };

  const adjustStartTime = (minutes: number) => {
    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);
    let newStart = new Date(start.getTime() + minutes * 60000);
    if (newStart > end) {
        newStart = end;
    }
    updateStartStates(newStart);
  };

  const adjustEndTime = (minutes: number) => {
    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);
    let newEnd = new Date(end.getTime() + minutes * 60000);
    if (newEnd < start) {
        newEnd = start;
    }
    updateEndStates(newEnd);
  };

  const setStartTimeToNow = () => {
    const now = new Date();
    const end = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);
    let newStart = now;
    if (newStart > end) {
      newStart = end;
    }
    updateStartStates(newStart);
  };

  const setEndTimeToNow = () => {
    const now = new Date();
    const start = getFullDate(year, month, day, hour, minute, second, ampm);
    let newEnd = now;
    if (newEnd < start) {
      newEnd = start;
    }
    updateEndStates(newEnd);
  };

  const handleSave = async () => {
    if (!activityId || !entryId || !isFormValid()) return;

    const startDate = getFullDate(year, month, day, hour, minute, second, ampm);
    const endDate = getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm);

    // One reference addresses both the full image and its thumbnail, so both
    // columns store the same array.
    const refs = photos.map(photo => photo.ref);
    const images = refs.length > 0 ? refs : undefined;

    await updateActivityEntry(activityId, entryId, startDate, endDate, notes, images, images, selectedTags);

    // Clean up photos the user removed during this edit — but only those no
    // other entry references, since a pasted entry can share these images.
    const kept = new Set(refs);
    const removed = originalRefs.current.filter(ref => !kept.has(ref));
    await deleteUnreferencedRefs(removed);

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/ActivityDetail?activityId=${activityId}`);
    }
  };

  /* ------------------------------------------------------------------ *
   * Copy / paste an entry between activities
   * ------------------------------------------------------------------ */

  /**
   * Copy this entry to the clipboard.
   *
   * Images travel as references, not data: embedding base64 would produce a
   * multi-megabyte clipboard string. The pasted entry ends up sharing the same
   * stored files, which is safe because deletes are reference-counted.
   */
  const handleCopyEntry = async () => {
    try {
      const imageCount = await copyEntryToClipboard(
        {
          startDate: getFullDate(year, month, day, hour, minute, second, ampm),
          endDate: getFullDate(endYear, endMonth, endDay, endHour, endMinute, endSecond, endAmpm),
          notes,
          images: photos.map(photo => photo.ref),
          tags: selectedTags,
        },
        activity?.name,
      );

      const parts: string[] = [];
      if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
      if (selectedTags.length > 0) {
        parts.push(`${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'}`);
      }
      showToast('Copied!', parts.length > 0 ? parts.join(' · ') : undefined);
    } catch (error) {
      console.error('Failed to copy entry', error);
      showToast('Could not copy', 'Writing to the clipboard failed.', 'error');
    }
  };

  /**
   * Paste a copied entry over this one.
   *
   * Notes and dates are overwritten; images and tags are merged in. Images
   * that cannot be resolved on this device are reported rather than silently
   * dropped — the clipboard text can travel between devices (Universal
   * Clipboard) but the image files cannot.
   */
  const handlePasteEntry = async () => {
    const { payload, error } = await readEntryFromClipboard();

    if (error) {
      showToast('Could not read clipboard', error, 'error');
      return;
    }
    if (!payload) {
      showToast('Nothing to paste', 'Copy an entry first, then paste it here.', 'warning');
      return;
    }

    setImporting(true);
    try {
      // Dates: overwritten with the copied entry's.
      updateStartStates(new Date(payload.startDate));
      updateEndStates(new Date(payload.endDate));

      // Notes: overwritten.
      setNotes(payload.notes ?? '');

      // Images: appended, sharing the source entry's files.
      const { available, missing } = await resolveAvailableImages(payload.images);
      let addedImages = 0;
      if (available.length > 0) {
        setPhotos(previous => {
          const mergedRefs = mergeImageRefs(previous.map(photo => photo.ref), available);
          addedImages = mergedRefs.length - previous.length;
          return mergedRefs.map((ref, index) => ({ ref, orderStr: (index + 1).toString() }));
        });
      }

      // Tags: merged by name, creating any this device does not have yet.
      const { merged, missing: tagsToCreate } = mergeTags(
        selectedTags,
        payload.tags,
        (name) => tags.find(tag => tag.name.toLowerCase() === name.toLowerCase()),
      );
      const created: Tag[] = [];
      for (const definition of tagsToCreate) {
        try {
          created.push(await addTag(definition.name, definition.color));
        } catch (tagError) {
          console.warn(`Could not create tag "${definition.name}"`, tagError);
        }
      }
      setSelectedTags([...merged, ...created]);

      const addedTags = merged.length + created.length - selectedTags.length;
      const detail = [
        addedImages > 0 ? `${addedImages} image${addedImages === 1 ? '' : 's'}` : null,
        addedTags > 0 ? `${addedTags} tag${addedTags === 1 ? '' : 's'}` : null,
      ].filter(Boolean);

      if (missing > 0) {
        // Worth interrupting for: images the copy referenced are not on this
        // device, so the paste is quietly incomplete.
        showToast(
          'Pasted!',
          `${missing} image${missing === 1 ? '' : 's'} unavailable on this device`,
          'warning',
        );
      } else {
        showToast('Pasted!', detail.length > 0 ? `${detail.join(' · ')} added` : undefined);
      }
    } catch (pasteError) {
      console.error('Failed to paste entry', pasteError);
      showToast('Could not paste', 'The copied entry could not be read.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const toggleTag = (tag: Tag) => {
    if (selectedTags.find(t => t.id === tag.id)) {
      setSelectedTags(prev => prev.filter(t => t.id !== tag.id));
    } else {
      setSelectedTags(prev => [...prev, tag]);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const tag = await addTag(newTagName, newTagColor);
    setSelectedTags(prev => [...prev, tag]);
    setNewTagName('');
    setNewTagModalVisible(false);
  };

  // Release decoded previews when leaving the editor.
  useEffect(() => () => { void clearImageMemoryCache(); }, []);

  if (entryLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: 60 }} color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!activity || !entry) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Entry not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/ActivityDetail?activityId=${activityId}`);
          }
        }}>
          <Icon name="close" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Edit Entry for {activity.name}</Text>
        {/*
          Copy this entry, or paste one copied from another activity. Paste
          overwrites the notes and dates and merges in images and tags.
        */}
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleCopyEntry}
            style={styles.headerButton}
            accessibilityLabel="Copy this entry"
          >
            <Icon name="content-copy" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handlePasteEntry}
            style={styles.headerButton}
            accessibilityLabel="Paste a copied entry"
          >
            <Icon name="content-paste" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Anchored just under the copy/paste buttons that trigger it. */}
      <Toast toast={toast} onHide={hideToast} />

      <ScrollView style={styles.content}>
        <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Start Date & Time</Text>
            <View style={styles.quickActions}>
                <TouchableOpacity onPress={setStartTimeToNow} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>Now</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(24 * 60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+1d</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(-24 * 60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-1d</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+1h</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(-60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-1h</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+5m</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustStartTime(-5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-5m</Text>
                </TouchableOpacity>
            </View>
        </View>
        <Text style={styles.label}>Date</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={month}
            onChangeText={setMonth}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={styles.input}
            placeholder="DD"
            value={day}
            onChangeText={setDay}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={[styles.input, {width: 80}] }
            placeholder="YYYY"
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
        <Text style={styles.label}>Time</Text>
        <View style={[styles.inputRow, { zIndex: 100 }]}>
          <TextInput
            style={styles.input}
            placeholder="HH"
            value={hour}
            onChangeText={setHour}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={minute}
            onChangeText={setMinute}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="SS"
            value={second}
            onChangeText={setSecond}
            keyboardType="number-pad"
            maxLength={2}
          />
          <View style={{ zIndex: 10, position: 'relative' }}>
            <TouchableOpacity
              style={[styles.input, { width: 85, marginLeft: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 }]}
              onPress={() => setStartAmpmDropdownVisible(!startAmpmDropdownVisible)}
            >
              <Text style={{ color: theme.colors.text, fontSize: 18 }}>{ampm || 'AM'}</Text>
              <Icon name={startAmpmDropdownVisible ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.text} />
            </TouchableOpacity>

            {startAmpmDropdownVisible && (
              <View style={styles.dropdownContainer}>
                <TouchableOpacity
                  style={styles.dropdownOption}
                  onPress={() => {
                    setAmpm('AM');
                    setStartAmpmDropdownVisible(false);
                  }}
                >
                  <Text style={styles.dropdownOptionText}>AM</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dropdownOption, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    setAmpm('PM');
                    setStartAmpmDropdownVisible(false);
                  }}
                >
                  <Text style={styles.dropdownOptionText}>PM</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>End Date & Time</Text>
            <View style={styles.quickActions}>
                <TouchableOpacity onPress={setEndTimeToNow} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>Now</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(24 * 60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+1d</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(-24 * 60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-1d</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+1h</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(-60)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-1h</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>+5m</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => adjustEndTime(-5)} style={styles.quickButton}>
                    <Text style={styles.quickButtonText}>-5m</Text>
                </TouchableOpacity>
            </View>
        </View>
        <Text style={styles.label}>Date</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={endMonth}
            onChangeText={setEndMonth}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={styles.input}
            placeholder="DD"
            value={endDay}
            onChangeText={setEndDay}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>/</Text>
          <TextInput
            style={[styles.input, {width: 80}] }
            placeholder="YYYY"
            value={endYear}
            onChangeText={setEndYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
        <Text style={styles.label}>Time</Text>
        <View style={[styles.inputRow, { zIndex: 50 }]}>
          <TextInput
            style={styles.input}
            placeholder="HH"
            value={endHour}
            onChangeText={setEndHour}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="MM"
            value={endMinute}
            onChangeText={setEndMinute}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.separator}>:</Text>
          <TextInput
            style={styles.input}
            placeholder="SS"
            value={endSecond}
            onChangeText={setEndSecond}
            keyboardType="number-pad"
            maxLength={2}
          />
          <View style={{ zIndex: 10, position: 'relative' }}>
            <TouchableOpacity
              style={[styles.input, { width: 85, marginLeft: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 }]}
              onPress={() => setEndAmpmDropdownVisible(!endAmpmDropdownVisible)}
            >
              <Text style={{ color: theme.colors.text, fontSize: 18 }}>{endAmpm || 'AM'}</Text>
              <Icon name={endAmpmDropdownVisible ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.text} />
            </TouchableOpacity>

            {endAmpmDropdownVisible && (
              <View style={styles.dropdownContainer}>
                <TouchableOpacity
                  style={styles.dropdownOption}
                  onPress={() => {
                    setEndAmpm('AM');
                    setEndAmpmDropdownVisible(false);
                  }}
                >
                  <Text style={styles.dropdownOptionText}>AM</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dropdownOption, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    setEndAmpm('PM');
                    setEndAmpmDropdownVisible(false);
                  }}
                >
                  <Text style={styles.dropdownOptionText}>PM</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <Text style={[styles.label, { marginTop: 20 }]}>Tags</Text>
        <View style={styles.tagsContainer}>
          {selectedTags.map(tag => (
            <View key={tag.id} style={[styles.tagItem, { backgroundColor: tag.color, opacity: 1 }]}>
              <Text style={styles.tagText}>{tag.name}</Text>
              <TouchableOpacity onPress={() => toggleTag(tag)} style={{ marginLeft: 5 }}>
                <Icon name="close-circle" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TextInput
          style={styles.tagSearchInput}
          placeholder="Search tags..."
          placeholderTextColor={theme.colors.subtext}
          value={tagSearch}
          onChangeText={setTagSearch}
        />

        {tagSearch.length > 0 && (
          <View style={styles.tagDropdown}>
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled={true}>
              {filteredAvailableTags.map(tag => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.tagDropdownItem}
                  onPress={() => {
                    toggleTag(tag);
                    setTagSearch('');
                  }}
                >
                  <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
                  <Text style={styles.tagDropdownText}>{tag.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.tagDropdownItem}
                onPress={() => {
                  setNewTagName(tagSearch);
                  setNewTagModalVisible(true);
                }}
              >
                <Icon name="plus" size={20} color={theme.colors.primary} style={{ marginRight: 10 }} />
                <Text style={[styles.tagDropdownText, { color: theme.colors.primary }]}>Create "{tagSearch}"</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}

        <Text style={[styles.label, { marginTop: 20 }]}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add notes here..."
          placeholderTextColor={theme.colors.subtext}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        <Text style={[styles.label, { marginTop: 20 }]}>Photos</Text>

        {photos.length > 0 && (
            <TouchableOpacity style={[styles.imageButton, { marginBottom: 15, justifyContent: 'center', backgroundColor: theme.colors.primary }]} onPress={() => {
                const sorted = [...photos].sort((a, b) => {
                    const numA = parseInt(a.orderStr) || 0;
                    const numB = parseInt(b.orderStr) || 0;
                    return numA - numB;
                }).map((p, idx) => ({...p, orderStr: (idx + 1).toString()}));
                setPhotos(sorted);
            }}>
                <Icon name="sort" size={20} color="#fff" />
                <Text style={[styles.imageButtonText, { color: '#fff' }]}>Rearrange</Text>
            </TouchableOpacity>
        )}

        {photos.map((photo, index) => (
            <View key={`${photo.ref}-${index}`} style={styles.photoItemContainer}>
                {/*
                  The editor preview renders the *thumbnail* variant, not the
                  full image. Previously this was a full-resolution decode per
                  photo, so opening an entry with 20 photos decoded 20 full
                  images at once purely to show 200pt previews. Tap to open the
                  full-size viewer, which mounts one image at a time.
                */}
                <TouchableOpacity activeOpacity={0.8} onPress={() => setViewerIndex(index)}>
                  <AppImage
                    imageRef={photo.ref}
                    variant="thumb"
                    usage="thumbnail"
                    recyclingKey={`editor-${photo.ref}`}
                    contentFit="contain"
                    style={styles.imagePreview}
                  />
                  <View style={styles.expandBadge}>
                    <Icon name="arrow-expand" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
                <View style={styles.photoControlsRow}>
                    <View style={styles.orderContainer}>
                        <Text style={styles.orderLabel}>Order:</Text>
                        <TextInput
                            style={styles.orderInput}
                            value={photo.orderStr}
                            onChangeText={(text) => {
                                setPhotos(prev => {
                                    const newPhotos = [...prev];
                                    newPhotos[index].orderStr = text;
                                    return newPhotos;
                                });
                            }}
                            keyboardType="number-pad"
                        />
                    </View>
                    <TouchableOpacity style={styles.photoControlButton} onPress={() => pickImage(index)}>
                        <Icon name="upload" size={20} color={theme.colors.text} />
                        <Text style={styles.photoControlText}>Upload</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoControlButton} onPress={() => pasteImage(index)}>
                        <Icon name="clipboard-outline" size={20} color={theme.colors.text} />
                        <Text style={styles.photoControlText}>Paste</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.photoControlButton, { backgroundColor: '#FF3B30' + '20' }]} onPress={() => {
                        setPhotos(prev => prev.filter((_, i) => i !== index));
                    }}>
                        <Icon name="delete" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                </View>
            </View>
        ))}

        <View style={styles.imageActions}>
          <TouchableOpacity style={styles.imageButton} onPress={() => pickImage(-1)}>
            <Icon name="image-plus" size={24} color={theme.colors.text} />
            <Text style={styles.imageButtonText}>Add Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.imageButton} onPress={() => pasteImage(-1)}>
            <Icon name="clipboard-arrow-down-outline" size={24} color={theme.colors.text} />
            <Text style={styles.imageButtonText}>Paste Photo</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity style={[styles.button, !isFormValidState && styles.disabledButton]} onPress={handleSave} disabled={!isFormValidState}>
          <Text style={styles.buttonText}>Save Changes</Text>
        </TouchableOpacity>
      </View>

      {/*
        Full-size viewer. The inline previews deliberately render the thumbnail
        variant, so this is where the full image is actually loaded — one at a
        time, via the gallery's windowing.
      */}
      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        <View style={styles.viewerOverlay}>
          <TouchableOpacity
            style={styles.viewerClose}
            onPress={() => setViewerIndex(null)}
            accessibilityLabel="Close image viewer"
          >
            <Icon name="close" size={30} color="#FFFFFF" />
          </TouchableOpacity>
          {viewerIndex !== null && photos.length > 0 && (
            <LargeImageGallery
              imageRefs={photos.map(photo => photo.ref)}
              entryId={`${entryId}-viewer`}
              initialIndex={viewerIndex}
            />
          )}
        </View>
      </Modal>

      <Modal
        visible={newTagModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setNewTagModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Tag</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Tag Name"
              placeholderTextColor={theme.colors.subtext}
              value={newTagName}
              onChangeText={setNewTagName}
            />
            <View style={styles.colorGrid}>
              {tagColors.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    newTagColor === color && styles.selectedColorOption
                  ]}
                  onPress={() => setNewTagColor(color)}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setNewTagModalVisible(false)}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.saveButton]} onPress={handleCreateTag}>
                <Text style={styles.modalButtonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 20,
  },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    // Flexes so a long activity name truncates instead of squeezing the icons.
    flex: 1,
    marginHorizontal: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerButton: {
    padding: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionLabel: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 15,
  },
  sectionHeaderRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginTop: 20,
    gap: 10,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  quickButton: {
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  quickButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  input: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    padding: 15,
    borderRadius: 10,
    fontSize: 18,
    width: 60,
    textAlign: 'center',
  },
  separator: {
    color: theme.colors.text,
    fontSize: 18,
    marginHorizontal: 10,
  },
  dropdownContainer: {
    position: 'absolute',
    top: 55,
    left: 15,
    width: 85,
    backgroundColor: theme.colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border || '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 9999,
  },
  dropdownOption: {
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border || '#333',
  },
  dropdownOptionText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tagItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    opacity: 0.6,
  },
  selectedTagItem: {
    opacity: 1,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  tagText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  addTagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  addTagText: {
    color: theme.colors.primary,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  tagSearchInput: {
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginTop: 10,
  },
  tagDropdown: {
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    marginTop: 5,
    borderWidth: 1,
    borderColor: theme.colors.border || '#333',
    overflow: 'hidden',
    zIndex: 1000,
  },
  tagDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border || '#333',
  },
  tagDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  tagDropdownText: {
    color: theme.colors.text,
    fontSize: 16,
  },
  notesInput: {
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    padding: 15,
    color: theme.colors.text,
    fontSize: 16,
    height: 120,
    textAlignVertical: 'top',
  },
  imageActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 15,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: 10,
    borderRadius: 10,
    gap: 5,
  },
  imageButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  imagePreviewContainer: {
    marginTop: 10,
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 10,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
  },
  expandBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    padding: 6,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  viewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 6,
  },
  photoItemContainer: {
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 10,
    marginBottom: 15,
  },
  photoControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  orderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderLabel: {
    color: theme.colors.text,
    marginRight: 5,
    fontSize: 14,
  },
  orderInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 40,
    textAlign: 'center',
  },
  photoControlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  photoControlText: {
    color: theme.colors.text,
    fontSize: 12,
  },
  footer: {
    padding: 20,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 30,
    padding: 20,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: theme.colors.disabled,
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: theme.colors.card,
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
    justifyContent: 'center',
  },
  colorOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  selectedColorOption: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: theme.colors.disabled,
  },
  saveButton: {
    backgroundColor: theme.colors.primary,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});

export default EditEntryScreen;
