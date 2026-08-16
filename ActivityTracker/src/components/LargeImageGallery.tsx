/**
 * Horizontal full-size gallery.
 *
 * The previous implementation had two problems that mattered a lot at scale:
 *  1. It called `Image.getSize()` for every image on mount purely to measure
 *     them. With data URIs that means fully decoding every image in the entry
 *     just to learn its dimensions — before a single pixel was drawn.
 *  2. It rendered every page inside a plain ScrollView, so an entry with 30
 *     photos mounted 30 full-resolution images at once.
 *
 * Now: a windowed FlatList mounts only the pages near the viewport, and
 * dimensions come from expo-image's onLoad, which reports the size of the
 * decode it was already doing.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  ListRenderItemInfo,
  Platform,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import AppImage from './AppImage';

interface LargeImageGalleryProps {
  /** Full-size image references. */
  imageRefs: string[];
  entryId?: string;
  /** Height of the gallery viewport. */
  height?: number;
}

const DEFAULT_HEIGHT = 260;

const LargeImageGallery: React.FC<LargeImageGalleryProps> = ({
  imageRefs,
  entryId,
  height = DEFAULT_HEIGHT,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const initialWidth = Platform.OS === 'web' ? Math.max(0, screenWidth - 40) : 0;
  const [containerWidth, setContainerWidth] = useState<number>(initialWidth);
  const [currentIndex, setCurrentIndex] = useState(0);
  const listRef = useRef<FlatList<string>>(null);

  const handleScroll = useCallback(
    (event: any) => {
      if (containerWidth <= 0) return;
      const index = Math.round(event.nativeEvent.contentOffset.x / containerWidth);
      setCurrentIndex(previous =>
        index !== previous && index >= 0 && index < imageRefs.length ? index : previous,
      );
    },
    [containerWidth, imageRefs.length],
  );

  const scrollTo = useCallback(
    (index: number) => {
      if (containerWidth > 0 && index >= 0 && index < imageRefs.length) {
        listRef.current?.scrollToOffset({ offset: index * containerWidth, animated: true });
      }
    },
    [containerWidth, imageRefs.length],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<string>) => (
      <View style={{ width: containerWidth, height, justifyContent: 'center', alignItems: 'center' }}>
        <AppImage
          imageRef={item}
          variant="full"
          usage="full"
          recyclingKey={`${entryId ?? 'gallery'}-${index}`}
          // contain preserves aspect ratio without needing to measure first.
          contentFit="contain"
          style={{ width: containerWidth, height, borderRadius: 10 }}
          // Only the page in view is worth prioritising.
          priority={index === currentIndex ? 'high' : 'low'}
        />
      </View>
    ),
    [containerWidth, currentIndex, entryId, height],
  );

  // Every page is exactly containerWidth wide, so the list can position items
  // without measuring them — no layout pass over offscreen images.
  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({
      length: containerWidth,
      offset: containerWidth * index,
      index,
    }),
    [containerWidth],
  );

  return (
    <View
      style={[styles.container, { height }]}
      onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <FlatList
          ref={listRef}
          data={imageRefs}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={containerWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyExtractor={(item, index) => `${entryId ?? 'gallery'}-${index}-${item}`}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          // The window that actually bounds memory: at most the current page
          // plus one either side is mounted, regardless of how many photos the
          // entry has.
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews={Platform.OS !== 'web'}
        />
      )}

      {imageRefs.length > 1 && (
        <>
          <TouchableOpacity
            style={[
              styles.navButton,
              styles.navButtonLeft,
              { backgroundColor: currentIndex === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' },
            ]}
            onPress={() => scrollTo(currentIndex - 1)}
            disabled={currentIndex === 0}
            accessibilityLabel="Previous image"
          >
            <Icon name="chevron-left" size={30} color={currentIndex === 0 ? 'rgba(0,0,0,0.3)' : '#000'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.navButton,
              styles.navButtonRight,
              {
                backgroundColor:
                  currentIndex === imageRefs.length - 1 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
              },
            ]}
            onPress={() => scrollTo(currentIndex + 1)}
            disabled={currentIndex === imageRefs.length - 1}
            accessibilityLabel="Next image"
          >
            <Icon
              name="chevron-right"
              size={30}
              color={currentIndex === imageRefs.length - 1 ? 'rgba(0,0,0,0.3)' : '#000'}
            />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    marginBottom: 15,
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    borderRadius: 20,
    padding: 5,
  },
  navButtonLeft: {
    left: 10,
  },
  navButtonRight: {
    right: 10,
  },
});

export default LargeImageGallery;
