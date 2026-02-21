import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

interface ActivityHistoryItemProps {
  date: Date;
  notes?: string;
  onEdit: () => void;
  onDelete: () => void;
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

const ActivityHistoryItem: React.FC<ActivityHistoryItemProps> = ({ date, notes, onEdit, onDelete }) => {
  const firstLine = notes ? notes.split('\n')[0] : '';

  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={styles.dateText}>{formatDate(date)}</Text>
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
    padding: 20,
    marginBottom: 15,
  },
  dateText: {
    color: theme.colors.text,
    fontSize: 16,
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
