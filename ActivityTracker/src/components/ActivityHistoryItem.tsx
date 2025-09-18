import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';

interface ActivityHistoryItemProps {
  date: Date;
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

const ActivityHistoryItem: React.FC<ActivityHistoryItemProps> = ({ date, onEdit, onDelete }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.dateText}>{formatDate(date)}</Text>
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
  buttons: {
    flexDirection: 'row',
  },
  button: {
    marginLeft: 20,
  },
});

export default ActivityHistoryItem;
