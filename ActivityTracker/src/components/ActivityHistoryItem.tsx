import React, { useState, useEffect, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Platform } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';
import { Tag } from '../data/activity-details';
import LargeImageGallery from './LargeImageGallery';
import LazyImage from './LazyImage';

export type ImageMode = 'small' | 'medium' | 'large' | 'hidden';

interface ActivityHistoryItemProps {
  startDate: Date;
  endDate: Date;
  notes?: string;
  images?: string[];
  thumbnails?: string[];
  onEdit: () => void;
  onDelete: () => void;
  imageMode?: ImageMode;
  tags?: Tag[];
  lastEntryEndDate?: Date;
  image?: string;
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

const areEqual = (prevProps: ActivityHistoryItemProps, nextProps: ActivityHistoryItemProps) => {
  if (prevProps.imageMode !== nextProps.imageMode) return false;
  if (prevProps.notes !== nextProps.notes) return false;
  if (prevProps.image !== nextProps.image) return false;

  if (prevProps.startDate?.getTime() !== nextProps.startDate?.getTime()) return false;
  if (prevProps.endDate?.getTime() !== nextProps.endDate?.getTime()) return false;
  if (prevProps.lastEntryEndDate?.getTime() !== nextProps.lastEntryEndDate?.getTime()) return false;

  const prevImages = prevProps.images || [];
  const nextImages = nextProps.images || [];
  if (prevImages.length !== nextImages.length) return false;
  for (let i = 0; i < prevImages.length; i++) {
    if (prevImages[i] !== nextImages[i]) return false;
  }

  const prevThumbnails = prevProps.thumbnails || [];
  const nextThumbnails = nextProps.thumbnails || [];
  if (prevThumbnails.length !== nextThumbnails.length) return false;
  for (let i = 0; i < prevThumbnails.length; i++) {
    if (prevThumbnails[i] !== nextThumbnails[i]) return false;
  }

  const prevTags = prevProps.tags || [];
  const nextTags = nextProps.tags || [];
  if (prevTags.length !== nextTags.length) return false;
  for (let i = 0; i < prevTags.length; i++) {
    if (prevTags[i].id !== nextTags[i].id || prevTags[i].name !== nextTags[i].name || prevTags[i].color !== nextTags[i].color) return false;
  }

  return true;
};

const ActivityHistoryItemComponent: React.FC<ActivityHistoryItemProps> = ({
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
  image
}) => {
  const [preloadedLargeImages, setPreloadedLargeImages] = useState<string[] | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let isMounted = true;
    const generatedUrls: string[] = [];

    const loadBlobs = async () => {
      const sourceImages = images || (image ? [image] : []);
      if (!sourceImages || sourceImages.length === 0) return;

      const loadedUrls = await Promise.all(sourceImages.map(async (imgStr) => {
        if (imgStr === "failed") return imgStr;
        const uri = imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}`;
        if (uri.startsWith('data:')) {
          try {
            const res = await fetch(uri);
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            if (!isMounted) {
              URL.revokeObjectURL(objectUrl);
              return uri;
            }
            generatedUrls.push(objectUrl);
            return objectUrl;
          } catch (e) {
            console.error("Error creating object URL in preloader", e);
            return uri;
          }
        }
        return uri;
      }));

      if (isMounted) {
        setPreloadedLargeImages(loadedUrls);
      }
    };

    loadBlobs();

    return () => {
      isMounted = false;
      generatedUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [images, image]);

  const firstLine = notes ? notes.split('\n')[0] : '';
  const duration = formatDuration(startDate, endDate);
  const isDifferentDate = startDate.getTime() !== endDate.getTime();
  const timeSinceLast = lastEntryEndDate ? formatSinceLastTime(lastEntryEndDate, startDate) : null;

  const renderImages = () => {
    if (imageMode === 'hidden' && !image) return null;

    const availableImages = images && images.length > 0 ? images : (image ? [image] : null);
    const availableThumbnails = thumbnails && thumbnails.length > 0 ? thumbnails : (image ? [image] : null);

    if (!availableImages && !availableThumbnails) return null;

    if (imageMode === 'small' || imageMode === 'medium') {
      const isMultiple = (availableImages && availableImages.length > 1) || (availableThumbnails && availableThumbnails.length > 1);
      const itemsToRender = availableThumbnails || availableImages || [];

      const elements = itemsToRender.map((imgStr, idx) => {
         if (imgStr === "failed") return null;
         const source = { uri: imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}` };
         return <LazyImage key={idx} source={source} style={imageMode === 'medium' ? styles.thumbnailMedium : styles.thumbnailSmall} />;
      });

      if (isMultiple) {
         return (
             <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15, width: '100%' }}>
                 {elements}
             </ScrollView>
         );
      } else {
         return elements[0];
      }
    }

    // Large Mode
    if (imageMode === 'large') {
      let itemsToRender = availableImages || availableThumbnails || [];
      if (Platform.OS === 'web' && preloadedLargeImages && availableImages) {
        itemsToRender = preloadedLargeImages;
      }

      if (!itemsToRender || itemsToRender.length === 0) return null;

      return <LargeImageGallery images={itemsToRender} />;
    }

    return null;
  };

  const isLarge = imageMode === 'large' && ((images && images.length > 0) || (thumbnails && thumbnails.length > 0) || image);
  const hasMultipleInRow = (imageMode === 'small' || imageMode === 'medium') && ((images && images.length > 1) || (thumbnails && thumbnails.length > 1));

  return (
    <View style={[styles.container, (isLarge || hasMultipleInRow) && styles.containerLarge]}>
      {(isLarge || hasMultipleInRow) ? renderImages() : null}
      <View style={[styles.contentWrapper, hasMultipleInRow && { marginTop: 0 }]}>
        {!(isLarge || hasMultipleInRow) ? renderImages() : null}
        <View style={styles.textContainer}>
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
