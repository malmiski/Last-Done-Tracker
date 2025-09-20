import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/RootNavigator';
import { activities } from '../data/activities';
import { activityDetails, ActivityEntry } from '../data/activity-details';
import ActivityHistoryItem from '../components/ActivityHistoryItem';

type ActivityDetailScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'ActivityDetail'
>;
type ActivityDetailScreenRouteProp = RouteProp<
  RootStackParamList,
  'ActivityDetail'
>;

interface Props {
  navigation: ActivityDetailScreenNavigationProp;
  route: ActivityDetailScreenRouteProp;
}

const ActivityDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { activityId } = route.params;
  const activity = activities.find(a => a.id === activityId);
  const [history, setHistory] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    if (activityId) {
      setHistory(activityDetails[activityId] || []);
    }
  }, [activityId]);

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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{activity.name}</Text>
        <View style={{ width: 30 }} />
      </View>
      <FlatList
        data={history}
        renderItem={({ item }) => (
          <ActivityHistoryItem
            date={item.date}
            onEdit={() => { /* Handle Edit */ }}
            onDelete={() => { /* Handle Delete */ }}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { /* Handle Add New Entry */ }}
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
