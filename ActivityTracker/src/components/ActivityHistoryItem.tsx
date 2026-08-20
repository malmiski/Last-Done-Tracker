import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';
import { Tag } from '../data/activity-details';
import LargeImageGallery from './LargeImageGallery';
import AppImage from './AppImage';

export type ImageMode = 'small' | 'medium' | 'large' | 'hidden';

interface ActivityHistoryItemProps {
  /** Stable id, used to key bitmap recycling. */
  entryId?: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  /** Full-size image references. */
  images?: string[];
  /** Thumbnail references, parallel to `images`. */
  thumbnails?: string[];
  onEdit: () => void;
  onDelete: () => void;
  imageMode?: ImageMode;
  tags?: Tag[];
  lastEntryEndDate?: Date;
  /**
   * Position in the activity's history, oldest being 1. Purely a label — it is
   * derived from where the row sits in the list and is never stored, so it
   * renumbers by itself when entries are added or removed.
   */
  index?: number;
}

const formatDate = (date: Date) => {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

const formatDuration = (start: Date, end: Date) => {
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return null;

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''}${remainingMins > 0 ? ` ${remainingMins} minute${remainingMins > 1 ? 's' : ''}` : ''}`;
  }
  return `${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
};

const formatSinceLastTime = (start: Date, end: Date) => {
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return null;

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''}${remainingHours > 0 ? ` ${remainingHours} hour${remainingHours > 1 ? 's' : ''}` : ''} since last time`;
  }

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''}${remainingMins > 0 ? ` ${remainingMins} minute${remainingMins > 1 ? 's' : ''}` : ''} since last time`;
  }
  return `${diffMins} minute${diffMins !== 1 ? 's' : ''} since last time`;
};

const sameRefs = (a?: string[], b?: string[]) => {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

/**
 * Comparing references is now trivially cheap. Previously these arrays held
 * hundreds of kilobytes of base64 each, so every re-render of the list ran a
 * string comparison over megabytes of data.
 */
const areEqual = (prevProps: ActivityHistoryItemProps, nextProps: ActivityHistoryItemProps) => {
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.imageMode !== nextProps.imageMode) return false;
  if (prevProps.notes !== nextProps.notes) return false;
  if (prevProps.entryId !== nextProps.entryId) return false;

  if (prevProps.startDate?.getTime() !== nextProps.startDate?.getTime()) return false;
  if (prevProps.endDate?.getTime() !== nextProps.endDate?.getTime()) return false;
  if (prevProps.lastEntryEndDate?.getTime() !== nextProps.lastEntryEndDate?.getTime()) return false;

  if (!sameRefs(prevProps.images, nextProps.images)) return false;
  if (!sameRefs(prevProps.thumbnails, nextProps.thumbnails)) return false;

  const prevTags = prevProps.tags || [];
  const nextTags = nextProps.tags || [];
  if (prevTags.length !== nextTags.length) return false;
  for (let i = 0; i < prevTags.length; i++) {
    if (prevTags[i].id !== nextTags[i].id || prevTags[i].name !== nextTags[i].name || prevTags[i].color !== nextTags[i].color) return false;
  }

  return true;
};

const ActivityHistoryItemComponent: React.FC<ActivityHistoryItemProps> = ({
  entryId,
  startDate,
  endDate,
  notes,
  images,
  thumbnails,
  onEdit,
  onDelete,
  imageMode = 'small',
  tags = [],
  lastEntryEndDate,
  index,
}) => {
  const firstLine = notes ? notes.split('\n')[0] : '';
  const duration = formatDuration(startDate, endDate);
  const isDifferentDate = startDate.getTime() !== endDate.getTime();
  const timeSinceLast = lastEntryEndDate ? formatSinceLastTime(lastEntryEndDate, startDate) : null;

  // A single reference addresses both variants, so thumbnails and images are
  // usually the same array; fall back either way for older rows.
  const thumbRefs = thumbnails && thumbnails.length > 0 ? thumbnails : images;
  const fullRefs = images && images.length > 0 ? images : thumbnails;

  const renderImages = () => {
    if (imageMode === 'hidden') return null;

    if (imageMode === 'small' || imageMode === 'medium') {
      if (!thumbRefs || thumbRefs.length === 0) return null;

      const elements = thumbRefs.map((ref, index) => (
        <AppImage
          key={`${entryId ?? 'entry'}-${index}`}
          imageRef={ref}
          // Always the thumbnail variant here: a 50pt tile has no business
          // touching the full-size file.
          variant="thumb"
          usage="thumbnail"
          recyclingKey={`${entryId ?? 'entry'}-${index}-${imageMode}`}
          style={imageMode === 'medium' ? styles.thumbnailMedium : styles.thumbnailSmall}
          contentFit="cover"
        />
      ));

      if (thumbRefs.length > 1) {
        return (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Stops a mostly-vertical drag that starts on a thumbnail from
            // being claimed by this scroller, which reads as the page getting
            // stuck at that row.
            directionalLockEnabled
            style={{ marginBottom: 15, width: '100%' }}
            /*
             * No removeClippedSubviews here. It detaches off-screen tiles, and
             * a detached view reports a zero-height layout, which changes the
             * measured height of the row that contains it. In a virtualised
             * list that means the total content height moves while you are
             * scrolling. It bought nothing either: the tiles are 50-100pt
             * thumbnails whose cost is bounded by the image store already.
             */
          >
            {elements}
          </ScrollView>
        );
      }
      return elements[0];
    }

    if (imageMode === 'large') {
      if (!fullRefs || fullRefs.length === 0) return null;
      return <LargeImageGallery imageRefs={fullRefs} entryId={entryId} />;
    }

    return null;
  };

  const hasAnyImage = (thumbRefs?.length ?? 0) > 0;
  const isLarge = imageMode === 'large' && (fullRefs?.length ?? 0) > 0;
  const hasMultipleInRow =
    (imageMode === 'small' || imageMode === 'medium') && (thumbRefs?.length ?? 0) > 1 && hasAnyImage;

  return (
    <View style={[styles.container, (isLarge || hasMultipleInRow) && styles.containerLarge]}>
      {(isLarge || hasMultipleInRow) ? renderImages() : null}
      <View style={[styles.contentWrapper, hasMultipleInRow && { marginTop: 0 }]}>
        {!(isLarge || hasMultipleInRow) ? renderImages() : null}
        <View style={styles.textContainer}>
          {/*
            Its own line rather than sharing one with the date: the date string
            is long, and prefixing it would wrap to two lines on a narrow
            screen for some rows and not others — variable row heights are
            exactly what makes a virtualised list scroll badly.
          */}
          {typeof index === 'number' ? (
            <Text style={styles.indexText}>#{index}</Text>
          ) : null}
          <Text style={styles.dateText}>
            {formatDate(startDate)}
            {isDifferentDate ? ` - ${formatDate(endDate)}` : ''}
          </Text>
          {duration ? <Text style={styles.durationText}>{duration}</Text> : null}
          {timeSinceLast ? <Text style={styles.sinceLastText}>{timeSinceLast}</Text> : null}
          {firstLine ? (
            <Text style={styles.notesPreview} numberOfLines={1} ellipsizeMode="tail">
              {firstLine}
            </Text>
          ) : null}
          {tags && tags.length > 0 && (
            <View style={styles.tagContainer}>
              {tags.map(tag => (
                <View key={tag.id} style={[styles.tag, { backgroundColor: tag.color }]}>
                  <Text style={styles.tagText}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={styles.buttons}>
          <TouchableOpacity onPress={onEdit} style={styles.button}>
            <Icon name="pencil-outline" size={24} color={theme.colors.subtext} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.button}>
            <Icon name="trash-can-outline" size={24} color={theme.colors.subtext} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
  },
  containerLarge: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  contentWrapper: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thumbnailSmall: {
    width: 50,
    height: 50,
    borderRadius: 5,
    marginRight: 15,
  },
  thumbnailMedium: {
    width: 100,
    height: 100,
    borderRadius: 10,
    marginRight: 15,
  },
  thumbnailLarge: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 15,
  },
  indexText: {
    color: theme.colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dateText: {
    color: theme.colors.text,
    fontSize: 14,
  },
  durationText: {
    color: theme.colors.primary,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  sinceLastText: {
    color: '#007AFF',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  textContainer: {
    flex: 1,
  },
  notesPreview: {
    color: theme.colors.subtext,
    fontSize: 14,
    marginTop: 5,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 5,
    gap: 5,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  tagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  buttons: {
    flexDirection: 'row',
  },
  button: {
    marginLeft: 20,
  },
});

const ActivityHistoryItem = memo(ActivityHistoryItemComponent, areEqual);
export default ActivityHistoryItem;
