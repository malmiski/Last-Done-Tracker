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

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours > 0 && diffMins > 0) return `${diffHours}h ${diffMins}m`;
  if (diffHours > 0) return `${diffHours}h`;
  return `${diffMins}m`;
};

const formatSinceLastTime = (lastEndDate: Date, currentStartDate: Date) => {
  const diffMs = currentStartDate.getTime() - lastEndDate.getTime();
  if (diffMs <= 0) return null;

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffDays > 0) return `${diffDays}d ${diffHours}h since last time`;
  if (diffHours > 0) return `${diffHours}h ${diffMins}m since last time`;
  return `${diffMins}m since last time`;
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
  const firstLine = notes ? notes.split('\n')[0] : '';
  const duration = formatDuration(startDate, endDate);
  const isDifferentDate = startDate.getTime() !== endDate.getTime();
  const timeSinceLast = lastEntryEndDate ? formatSinceLastTime(lastEntryEndDate, startDate) : null;

  const [webBlobImages, setWebBlobImages] = useState<string[]>([]);
  const [webBlobThumbnails, setWebBlobThumbnails] = useState<string[]>([]);
  const [isProcessingBlobs, setIsProcessingBlobs] = useState(Platform.OS === 'web');

  useEffect(() => {
    let activeBlobs: string[] = [];

    if (Platform.OS === 'web') {
      setIsProcessingBlobs(true);
      const convertToBlobUrl = async (imgStr: string) => {
        if (imgStr.startsWith('blob:') || imgStr === "failed") return imgStr;
        const base64Uri = imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}`;
        try {
          const res = await fetch(base64Uri);
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          activeBlobs.push(objUrl);
          return objUrl;
        } catch (e) {
          return base64Uri;
        }
      };

      const processImages = async () => {
        if (images && images.length > 0) {
          const blobs = await Promise.all(images.map(convertToBlobUrl));
          setWebBlobImages(blobs);
        } else if (image) {
           const blob = await convertToBlobUrl(image);
           setWebBlobImages([blob]);
        }

        if (thumbnails && thumbnails.length > 0) {
          const blobs = await Promise.all(thumbnails.map(convertToBlobUrl));
          setWebBlobThumbnails(blobs);
        } else if (image) {
           const blob = await convertToBlobUrl(image);
           setWebBlobThumbnails([blob]);
        }
        setIsProcessingBlobs(false);
      };
      processImages();

      return () => {
         activeBlobs.forEach(blobUrl => URL.revokeObjectURL(blobUrl));
      };
    }
  }, [images, thumbnails, image]);

  const renderImages = () => {
    if (imageMode === 'hidden' && !image) return null;

    if (Platform.OS === 'web' && isProcessingBlobs) {
        // Return a transparent loading container while we generate blobs
        // to avoid ever rendering raw base64 to the DOM string limit
        return <View style={{ width: '100%', height: imageMode === 'large' ? 200 : 50 }} />;
    }

    const availableImages = Platform.OS === 'web' && webBlobImages.length > 0 ? webBlobImages : (images && images.length > 0 ? images : (image ? [image] : null));
    const availableThumbnails = Platform.OS === 'web' && webBlobThumbnails.length > 0 ? webBlobThumbnails : (thumbnails && thumbnails.length > 0 ? thumbnails : (image ? [image] : null));

    if (!availableImages && !availableThumbnails) return null;

    if (imageMode === 'small' || imageMode === 'medium') {
      const isMultiple = (availableImages && availableImages.length > 1) || (availableThumbnails && availableThumbnails.length > 1);
      const itemsToRender = availableThumbnails || availableImages || [];

      const elements = itemsToRender.map((imgStr, idx) => {
         if (imgStr === "failed") return null;
         const source = { uri: (imgStr.startsWith('data:') || imgStr.startsWith('file:') || imgStr.startsWith('blob:')) ? imgStr : `data:image/jpeg;base64,${imgStr}` };
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
      const itemsToRender = availableImages || availableThumbnails || [];
      if (!itemsToRender || itemsToRender.length === 0) return null;

      return <LargeImageGallery images={itemsToRender} />;
    }

    return null;
  };

  const isLarge = imageMode === 'large' && ((images && images.length > 0) || (thumbnails && thumbnails.length > 0) || image);

  return (
    <View style={[styles.container, isLarge ? styles.containerLarge : null]}>
      {timeSinceLast && (
        <Text style={styles.sinceLastText}>
          {timeSinceLast}
        </Text>
      )}

      {renderImages()}

      {isLarge && (
         <Text style={[styles.dateText, { marginBottom: 15, width: '100%' }]} numberOfLines={2}>
           {firstLine || ''}
         </Text>
      )}

      <View style={styles.contentRow}>
        <View style={styles.infoContainer}>
          {!isLarge && (
            <Text style={styles.notesText} numberOfLines={1} ellipsizeMode="tail">
              {firstLine || ''}
            </Text>
          )}

          <Text style={styles.dateText}>
            {formatDate(startDate)}
          </Text>

          {isDifferentDate && (
             <Text style={styles.dateText}>
               to {formatDate(endDate)}
               {duration ? ` (${duration})` : ''}
             </Text>
          )}
        </View>

        <View style={styles.actionContainer}>
          <TouchableOpacity onPress={onEdit} style={styles.button}>
            <Icon name="pencil" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.button}>
            <Icon name="delete" size={24} color={theme.colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      {tags && tags.length > 0 && (
         <View style={styles.tagsContainer}>
            {tags.map((tag) => (
               <View key={tag.id} style={[styles.tagBadge, { backgroundColor: tag.color + '20' }]}>
                  <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
               </View>
            ))}
         </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  containerLarge: {
     flexDirection: 'column',
     alignItems: 'center',
  },
  sinceLastText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 10,
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  infoContainer: {
    flex: 1,
    marginRight: 10,
  },
  actionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notesText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 5,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  thumbnailSmall: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#eee',
  },
  thumbnailMedium: {
    width: 60,
    height: 60,
    borderRadius: 10,
    marginRight: 15,
    backgroundColor: '#eee',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    width: '100%',
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 6,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    marginLeft: 20,
  },
});

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
  if (prevImages.some((img, i) => img !== nextImages[i])) return false;

  const prevThumbnails = prevProps.thumbnails || [];
  const nextThumbnails = nextProps.thumbnails || [];
  if (prevThumbnails.length !== nextThumbnails.length) return false;
  if (prevThumbnails.some((img, i) => img !== nextThumbnails[i])) return false;

  const prevTags = prevProps.tags || [];
  const nextTags = nextProps.tags || [];
  if (prevTags.length !== nextTags.length) return false;
  if (prevTags.some((tag, i) => tag.id !== nextTags[i].id)) return false;

  return true;
};

const ActivityHistoryItem = memo(ActivityHistoryItemComponent, areEqual);
export default ActivityHistoryItem;
