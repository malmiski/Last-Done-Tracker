import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import theme from '../theme/theme';
import { activities as initialActivities, Activity } from '../data/activities';
import ActivityListItem from '../components/ActivityListItem';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { StackNavigationProp } from '@react-navigation/stack';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { RootStackParamList } from '../navigation/RootNavigator';

type ActivitiesScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'Activities'
>;

interface Props {
  navigation: ActivitiesScreenNavigationProp;
}

const ActivitiesScreen: React.FC<Props> = ({ navigation }) => {
  const [activities, setActivities] = useState(initialActivities);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const rotation = useSharedValue(0);

  useEffect(() => {
    const loadActivities = async () => {
      try {
        const storedActivities = await AsyncStorage.getItem('@activities');
        if (storedActivities !== null) {
          setActivities(JSON.parse(storedActivities));
        }
      } catch (e) {
        console.error('Failed to load activities.', e);
      }
    };
    loadActivities();
  }, []);

  useEffect(() => {
    const saveActivities = async () => {
      try {
        await AsyncStorage.setItem('@activities', JSON.stringify(activities));
      } catch (e) {
        console.error('Failed to save activities.', e);
      }
    };
    if (activities !== initialActivities) {
      saveActivities();
    }
  }, [activities]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  const filteredActivities = activities.filter(activity =>
    activity.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = (activityId: string) => {
    setActivities(activities.filter(a => a.id !== activityId));
  };

  const handleAddTime = (activityId: string) => {
    setActivities(
      activities.map(a =>
        a.id === activityId ? { ...a, lastDone: new Date().toLocaleDateString() } : a
      )
    );
  };

  const toggleEditMode = () => {
    setIsEditMode(!isEditMode);
    rotation.value = withTiming(isEditMode ? 0 : 360, { duration: 300 });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Activities</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={toggleEditMode} style={{marginRight: 15}}>
            <Animated.View style={animatedStyle}>
              <Icon name={isEditMode ? "check" : "pencil-outline"} size={30} color={theme.colors.text} />
            </Animated.View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Icon name="cog-outline" size={30} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color={theme.colors.subtext} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search activities..."
          placeholderTextColor={theme.colors.subtext}
          value={searchQuery}
          onChangeText={setSearchQuery}
          editable={!isEditMode}
        />
      </View>
      <FlatList
        data={filteredActivities}
        renderItem={({ item }) => (
          <ActivityListItem
            item={item}
            onPress={() => navigation.navigate('ActivityDetail', { activityId: item.id })}
            isEditMode={isEditMode}
            onDelete={() => handleDelete(item.id)}
            onAddTime={() => handleAddTime(item.id)}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddActivity')}
      >
        <Icon name="plus" size={30} color={theme.colors.background} />
        <Text style={styles.fabText}>Add Activity</Text>
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
    fontSize: 34,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 15,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 17,
    paddingVertical: 15,
  },
  listContent: {
    paddingHorizontal: 20,
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

export default ActivitiesScreen;
