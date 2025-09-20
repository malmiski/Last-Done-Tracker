import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import theme from '../theme/theme';
import { Activity } from '../data/activities';

interface ActivityListItemProps {
  item: Activity;
  onPress: () => void;
  isEditMode: boolean;
  onDelete: () => void;
  onAddTime: () => void;
}

const ActivityListItem: React.FC<ActivityListItemProps> = ({ item, onPress, isEditMode, onDelete, onAddTime }) => {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress} disabled={isEditMode}>
      <View style={styles.iconContainer}>
        <Icon name={item.icon} size={24} color={theme.colors.text} />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.lastDone}>{item.lastDone}</Text>
      </View>
      {isEditMode ? (
        <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
          <Icon name="trash-can-outline" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onAddTime} style={styles.addButton}>
          <Icon name="plus" size={32} color={theme.colors.primary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  textContainer: {
    flex: 1,
  },
  name: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  lastDone: {
    color: theme.colors.subtext,
    fontSize: 14,
    marginTop: 5,
  },
  deleteButton: {
    backgroundColor: theme.colors.notification,
    width: 48,
    height: 48,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ActivityListItem;
