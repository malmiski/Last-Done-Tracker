const fs = require('fs');

const path = 'ActivityTracker/app/ActivityDetail.tsx';
let content = fs.readFileSync(path, 'utf8');

// Imports
content = content.replace("import React, { useState, useCallback } from 'react';", "import React, { useState, useCallback, useRef } from 'react';");
content = content.replace("import { useActivityData } from '../src/hooks/useActivityData';", "import { useActivityData } from '../src/hooks/useActivityData';\nimport { formatTimeAgo } from '../src/utils/time';");

// ref & function
const scrollCode = `
  const flatListRef = useRef<FlatList>(null);

  const scrollToRandom = () => {
    if (filteredHistory.length > 0) {
      const randomIndex = Math.floor(Math.random() * filteredHistory.length);
      flatListRef.current?.scrollToIndex({ index: randomIndex, animated: true });
    }
  };

  if (!activity) {
`;

content = content.replace("  if (!activity) {", scrollCode);

// Header
const oldHeader = `      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/Activities"); } }}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{activity.name}</Text>`;

const newHeader = `      <View style={styles.header}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/Activities"); } }}>
            <Icon name="arrow-left" size={30} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={scrollToRandom} style={{marginLeft: 15}}>
            <Icon name="dice-multiple" size={30} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{activity.name}</Text>`;

content = content.replace(oldHeader, newHeader);

// FlatList
const oldFlatList = `      <FlatList
        data={filteredHistory}
        renderItem={({ item }) => (
          <ActivityHistoryItem
            startDate={item.startDate}
            endDate={item.endDate}
            notes={item.notes}
            images={item.images}
            thumbnails={item.thumbnails}
            imageMode={imageMode}
            tags={item.tags}
            onEdit={() => router.push(\`/EditEntry?activityId=\${activityId}&entryId=\${item.id}\`)}
            onDelete={() => deleteActivityEntry(activityId, item.id)}
          />
        )}`;

const newFlatList = `      <FlatList
        ref={flatListRef}
        data={filteredHistory}
        onScrollToIndexFailed={(info) => {
          const wait = new Promise(resolve => setTimeout(resolve, 500));
          wait.then(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: true });
          });
        }}
        renderItem={({ item, index }) => {
          const previousEntry = index < filteredHistory.length - 1 ? filteredHistory[index + 1] : undefined;
          const timeSincePrevious = previousEntry ? formatTimeAgo(previousEntry.startDate, item.startDate) : undefined;

          return (
            <ActivityHistoryItem
              startDate={item.startDate}
              endDate={item.endDate}
              notes={item.notes}
              images={item.images}
              thumbnails={item.thumbnails}
              imageMode={imageMode}
              tags={item.tags}
              timeSincePrevious={timeSincePrevious}
              onEdit={() => router.push(\`/EditEntry?activityId=\${activityId}&entryId=\${item.id}\`)}
              onDelete={() => deleteActivityEntry(activityId, item.id)}
            />
          );
        }}`;

content = content.replace(oldFlatList, newFlatList);

fs.writeFileSync(path, content, 'utf8');
