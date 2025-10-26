import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import ActivityHistoryItem from '../src/components/ActivityHistoryItem';
import { useActivityData } from '../src/hooks/useActivityData';
import DateTimePicker from '@react-native-community/datetimepicker';

const ActivityDetailScreen: React.FC = () => {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { activityDetails, getActivityById, addActivityEntry, deleteActivityEntry, refreshData } = useActivityData();

  useFocusEffect(
    useCallback(() => {
      if (refreshData) {
        refreshData();
      }
    }, [refreshData])
  );

  const activity = getActivityById(activityId);
  const history = (activityDetails[activityId] || []).sort((a, b) => b.date.getTime() - a.date.getTime());
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
        <TouchableOpacity onPress={() => router.replace("/Activities")}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{activity.name}</Text>
        <View style={styles.headerButtons}>
        <TouchableOpacity onPress={() => router.push(`/EditActivity?activityId=${activityId}`)} style={{paddingRight:10}}>
          <Icon name="pencil-outline" size={30} color={theme.colors.text}  />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push(`/GraphView?activityId=${activityId}`)}>
          <Icon name="chart-line" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={history}
        renderItem={({ item }) => (
          <ActivityHistoryItem
            date={item.date}
            onEdit={() => router.push(`/EditEntry?activityId=${activityId}&entryId=${item.id}`)}
            onDelete={() => deleteActivityEntry(activityId, item.id)}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => addActivityEntry(activityId, new Date())}
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
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 100,
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