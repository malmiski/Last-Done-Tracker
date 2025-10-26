import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { subDays, format, differenceInDays } from 'date-fns';

const screenWidth = Dimensions.get('window').width;

const timeWindows = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

const GraphViewScreen: React.FC = () => {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { getActivityById, activityDetails } = useActivityData();
  const [timeWindow, setTimeWindow] = useState<'7d' | '30d' | 'all'>('7d');

  const activity = getActivityById(activityId);
  const history = activityDetails[activityId] || [];

  const chartData = useMemo(() => {
    const now = new Date();
    let startDate: Date;

    if (timeWindow === '7d') {
      startDate = subDays(now, 7);
    } else if (timeWindow === '30d') {
      startDate = subDays(now, 30);
    } else {
      startDate = history.length > 0 ? new Date(history[history.length - 1].date) : now;
    }

    const filteredHistory = history.filter(item => new Date(item.date) >= startDate);

    const entriesByDay = filteredHistory.reduce((acc, item) => {
      const day = format(new Date(item.date), 'yyyy-MM-dd');
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(entriesByDay)
      .map(([date, count]) => ({
        date: date,
        value: count,
        label: format(new Date(date), 'MMM d'),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  }, [history, timeWindow]);

  const stats = useMemo(() => {
    const totalCount = history.length;
    if (totalCount < 2) {
      return { totalCount, frequency: 'N/A' };
    }
    const firstDate = new Date(history[history.length - 1].date);
    const lastDate = new Date(history[0].date);
    const totalDays = differenceInDays(lastDate, firstDate);
    const frequency = totalDays > 0 ? (totalCount / totalDays).toFixed(2) : totalCount;

    return {
      totalCount,
      frequency: totalDays > 0 ? `${frequency} times/day` : 'Daily',
    };
  }, [history]);

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
        <TouchableOpacity onPress={() => {console.log(activityId); router.replace("/ActivityDetail?activityId="+activityId)}}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{activity.name} Graph</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.chartContainer}>
        {chartData.length > 0 ? (
           <LineChart
            data={chartData}
            height={220}
            width={screenWidth - 80}
            color={theme.colors.primary}
            thickness={3}
            startFillColor={theme.colors.primary}
            endFillColor={theme.colors.background}
            areaChart
            yAxisTextStyle={{ color: theme.colors.text }}
            xAxisLabelTextStyle={{ color: theme.colors.text }}
            xAxisColor={theme.colors.border}
            yAxisColor={theme.colors.border}
            dataPointsColor={theme.colors.accent}
            dataPointsRadius={8}
            textColor={theme.colors.text}
            hideDataPoints={false}
            adjustToWidth
          />
        ) : (
          <View style={styles.noDataContainer}>
            <Text style={styles.noDataText}>No data available for this period.</Text>
          </View>
        )}
      </View>

      <View style={styles.timeWindowSelector}>
        {timeWindows.map(window => (
          <TouchableOpacity
            key={window.key}
            style={[
              styles.timeWindowButton,
              timeWindow === window.key && styles.selectedTimeWindow,
            ]}
            onPress={() => setTimeWindow(window.key as any)}
          >
            <Text
              style={[
                styles.timeWindowText,
                timeWindow === window.key && styles.selectedTimeWindowText,
              ]}
            >
              {window.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.statsContainer}>
        <Text style={styles.statsTitle}>Summary</Text>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Total Entries:</Text>
          <Text style={styles.statValue}>{stats.totalCount}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Frequency:</Text>
          <Text style={styles.statValue}>{stats.frequency}</Text>
        </View>
      </View>
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
  chartContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  noDataContainer: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: theme.colors.text,
    fontSize: 16,
  },
  timeWindowSelector: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 30,
    marginHorizontal: 20,
  },
  timeWindowButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: theme.colors.card,
  },
  selectedTimeWindow: {
    backgroundColor: theme.colors.primary,
  },
  timeWindowText: {
    color: theme.colors.text,
    fontWeight: 'bold',
  },
  selectedTimeWindowText: {
    color: theme.colors.background,
  },
  statsContainer: {
    marginTop: 40,
    marginHorizontal: 20,
    padding: 20,
    backgroundColor: theme.colors.card,
    borderRadius: 10,
  },
  statsTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  statItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statLabel: {
    color: theme.colors.text,
    fontSize: 16,
  },
  statValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default GraphViewScreen;