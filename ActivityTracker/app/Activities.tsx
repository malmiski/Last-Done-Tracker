import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import ActivityListItem from '../src/components/ActivityListItem';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { useActivityData } from '../src/hooks/useActivityData';

type FloatingIcon = {
  id: number;
  icon: string;
  x: number;
  y: number;
};

const FloatingIconComponent = ({ icon, onAnimationComplete, startX, startY }) => {
  const translateY = useSharedValue(startY);
  const translateX = useSharedValue(startX);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  React.useEffect(() => {
    translateY.value = withTiming(startY - 200, {
      duration: 500,
      easing: Easing.out(Easing.linear),
    }, () => runOnJS(onAnimationComplete)());
    opacity.value = withTiming(0, {
      duration: 500,
      easing: Easing.in(Easing.ease),
    });
    scale.value = withTiming(0.5, {
      duration: 500,
      easing: Easing.in(Easing.ease),
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
      opacity: opacity.value,
      position: 'absolute',
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <Icon name={icon} size={30} color={theme.colors.text} />
    </Animated.View>
  );
};

const ActivitiesScreen: React.FC = () => {
  const router = useRouter();
  const { activities, activityDetails, loading, deleteActivity, addActivityEntry, refreshData } = useActivityData();
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const rotation = useSharedValue(0);
  const [floatingIcons, setFloatingIcons] = useState<FloatingIcon[]>([]);
  const flatListRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      refreshData();
    }, [refreshData])
  );

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  const filteredActivities = activities.filter(activity =>
    activity.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = (activityId: string) => {
    deleteActivity(activityId);
  };

  const handleAddTime = (activityId: string, icon: string, x: number, y: number) => {
    addActivityEntry(activityId, new Date());

    const newIcon: FloatingIcon = {
      id: Date.now(),
      icon: icon,
      x: x,
      y: y,
    };

    setFloatingIcons(prev => [...prev, newIcon]);
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
          <TouchableOpacity onPress={toggleEditMode} style={{ marginRight: 15 }}>
            <Animated.View style={animatedStyle}>
              <Icon name={isEditMode ? "check" : "pencil-outline"} size={30} color={theme.colors.text} />
            </Animated.View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/Settings')}>
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
        ref={flatListRef}
        data={filteredActivities}
        renderItem={({ item, index }) => {
          const lastEntry = activityDetails[item.id]?.[0];
          const lastEntryDate = lastEntry ? lastEntry.date : null;
          return (
            <ActivityListItem
              item={item}
              onPress={() => router.push(`/ActivityDetail?activityId=${item.id}`)}
              isEditMode={isEditMode}
              onDelete={() => handleDelete(item.id)}
              onAddTime={(x, y) => handleAddTime(item.id, item.icon, x, y)}
              lastEntryDate={lastEntryDate}
            />
          );
        }}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
      {floatingIcons.map(icon => (
        <FloatingIconComponent
          key={icon.id}
          icon={icon.icon}
          startX={icon.x}
          startY={icon.y}
          onAnimationComplete={() =>
            setFloatingIcons(prev => prev.filter(i => i.id !== icon.id))
          }
        />
      ))}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/AddActivity')}
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

export default ActivitiesScreen;