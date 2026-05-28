import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';
import { Tag } from '../data/activity-details';

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

const ActivityHistoryItem: React.FC<ActivityHistoryItemProps> = ({
  startDate,
  endDate,
  notes,
  images,
  thumbnails,
  onEdit,
  onDelete,
  imageMode = 'small',
  tags = []
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const firstLine = notes ? notes.split('\n')[0] : '';
  const duration = formatDuration(startDate, endDate);
  const isDifferentDate = startDate.getTime() !== endDate.getTime();

  const renderImages = () => {
    if (imageMode === 'hidden' || (!images && !thumbnails)) return null;

    const availableImages = images && images.length > 0 ? images : null;
    const availableThumbnails = thumbnails && thumbnails.length > 0 ? thumbnails : null;

    if (!availableImages && !availableThumbnails) return null;

    if (imageMode === 'small' || imageMode === 'medium') {
      const isMultiple = (availableImages && availableImages.length > 1) || (availableThumbnails && availableThumbnails.length > 1);
      const itemsToRender = availableThumbnails || availableImages || [];

      const elements = itemsToRender.map((imgStr, idx) => {
         if (imgStr === "failed") return null;
         const source = { uri: imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}` };
         return <Image key={idx} source={source} style={imageMode === 'medium' ? styles.thumbnailMedium : styles.thumbnailSmall} />;
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

      const targetImage = itemsToRender[currentImageIndex];
      if (!targetImage || targetImage === "failed") return null;
      const source = { uri: targetImage.startsWith('data:') ? targetImage : `data:image/jpeg;base64,${targetImage}` };

      return (
        <View style={{ position: 'relative', width: '100%' }}>
            <Image source={source} style={styles.thumbnailLarge} />
            {itemsToRender.length > 1 && (
                <TouchableOpacity
                    style={{ position: 'absolute', right: 10, top: '50%', marginTop: -20, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 20, padding: 5 }}
                    onPress={() => setCurrentImageIndex((prev) => (prev + 1) % itemsToRender.length)}
                >
                    <Icon name="chevron-right" size={30} color="#000" />
                </TouchableOpacity>
            )}
        </View>
      );
    }

    return null;
  };

  const isLarge = imageMode === 'large' && ((images && images.length > 0) || (thumbnails && thumbnails.length > 0));
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

export default ActivityHistoryItem;
