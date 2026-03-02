import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

interface ActivityHistoryItemProps {
  startDate: Date;
  endDate: Date;
  notes?: string;
  image?: string;
  onEdit: () => void;
  onDelete: () => void;
}

const formatDate = (date: Date) => {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-').replace(',', ':');
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

const ActivityHistoryItem: React.FC<ActivityHistoryItemProps> = ({ startDate, endDate, notes, image, onEdit, onDelete }) => {
  const firstLine = notes ? notes.split('\n')[0] : '';
  const duration = formatDuration(startDate, endDate);
  const isDifferentDate = startDate.getTime() !== endDate.getTime();

  return (
    <View style={styles.container}>
      {image ? (
        <Image
          source={{ uri: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` }}
          style={styles.thumbnail}
        />
      ) : null}
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
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: 5,
    marginRight: 15,
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
  buttons: {
    flexDirection: 'row',
  },
  button: {
    marginLeft: 20,
  },
});

export default ActivityHistoryItem;
