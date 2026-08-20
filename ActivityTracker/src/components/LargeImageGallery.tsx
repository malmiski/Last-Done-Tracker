/**
 * Horizontal full-size gallery.
 *
 * Sizing matches the original behaviour: each image fills the container width
 * (scaled down to fit, never up), keeps its natural aspect ratio, and the
 * gallery as a whole takes the height of its tallest image so paging between
 * them does not make the card jump.
 *
 * What changed is how the dimensions are obtained. The original called
 * `Image.getSize()` on every image on mount, which fully decodes each one just
 * to measure it — with data URIs that meant decoding the entire entry's
 * photos before drawing a single pixel. Dimensions now come from the JPEG
 * header via a bounded read, so measuring is essentially free.
 *
 * Rendering is windowed: only the page in view plus its neighbours are
 * mounted, so an entry with thirty photos costs the same as one with three.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getImageSize } from '../utils/imageStore';
import { ImageSize, fillWidth, fitToWidth } from '../utils/jpegSize';

interface LargeImageGalleryProps {
  /** Full-size image references. */
  imageRefs: string[];
  entryId?: string;
  /** Fixed height override. Omit to size to the tallest image. */
  height?: number;
  /**
   * Width to lay out at, when the caller already knows it.
   *
   * Supplying it skips the measure-then-resize that onLayout would otherwise
   * cause. In the entry list the caller has to know this anyway, because it
   * computed the row's height from it.
   */
  width?: number;
  /**
   * Natural sizes of the images, in order, when they are already known.
   *
   * With these the gallery never reads a header and never changes size after
   * mounting. Without them it measures as before and reports what it found
   * through `onMeasured`, so the next time this row is laid out its height is
   * known in advance.
   */
  imageSizes?: ImageSize[] | null;
  onMeasured?: (ref: string, size: ImageSize) => void;
  /** Page to open on first render. */
  initialIndex?: number;
}

/** Used until the first image has been measured, and for unmeasurable files. */
const FALLBACK_HEIGHT = 200;

const LargeImageGallery: React.FC<LargeImageGalleryProps> = ({
  imageRefs,
  entryId,
  height: fixedHeight,
  width: fixedWidth,
  imageSizes,
  onMeasured,
  initialIndex = 0,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const initialWidth = fixedWidth ?? (Platform.OS === 'web' ? Math.max(0, screenWidth - 40) : 0);
  const [measuredWidth, setMeasuredWidth] = useState<number>(initialWidth);
  const containerWidth = fixedWidth ?? measuredWidth;
  const [sizes, setSizes] = useState<Record<number, ImageSize>>({});
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);

  /**
   * Sizes supplied by the caller, scaled to the width we are laying out at.
   *
   * When these are present the measuring effect below never runs, so the
   * gallery is the right height on its very first frame. That is the whole
   * point: a gallery that resizes after mounting changes the height of the
   * list row containing it, and the list then has to move everything below.
   */
  const providedSizes = useMemo(() => {
    if (!imageSizes || imageSizes.length !== imageRefs.length || containerWidth <= 0) return null;
    const scaled: Record<number, ImageSize> = {};
    imageSizes.forEach((size, index) => {
      scaled[index] = fitToWidth(size, containerWidth);
    });
    return scaled;
  }, [imageSizes, imageRefs.length, containerWidth]);

  // Measure every image once the container width is known. Each measurement is
  // a bounded header read, so this stays cheap even for long galleries.
  useEffect(() => {
    if (providedSizes) return;
    if (containerWidth <= 0 || imageRefs.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (let index = 0; index < imageRefs.length; index++) {
        const ref = imageRefs[index];

        // Measure the FULL image, not the thumbnail. The thumbnail is a 400px
        // proxy, and since fitToWidth only scales down, measuring it would pin
        // every image to 400px wide however wide the container is. Reading the
        // full file's header costs the same bounded 64KB as the thumbnail's.
        const natural = await getImageSize(ref, 'full');
        if (cancelled) return;

        let scaled: ImageSize | null = null;
        if (natural) {
          // Hand the natural size back so nothing has to read this header
          // again — not this session, and not on the next launch.
          onMeasured?.(ref, natural);
          scaled = fitToWidth(natural, containerWidth);
        } else {
          // No full-size file (an unusual, partially restored entry). The
          // thumbnail still gives a trustworthy aspect ratio, so fill the
          // width with that rather than fall back to the proxy's pixel size.
          const ratio = await getImageSize(ref, 'thumb');
          if (cancelled) return;
          if (ratio) scaled = fillWidth(ratio, containerWidth);
        }
        if (!scaled) continue;

        const next = scaled;
        setSizes(previous =>
          previous[index]?.width === next.width && previous[index]?.height === next.height
            ? previous
            : { ...previous, [index]: next },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageRefs, containerWidth, providedSizes, onMeasured]);

  const effectiveSizes = providedSizes ?? sizes;

  // The gallery is as tall as its tallest image, which is what keeps pages a
  // consistent height while swiping.
  const measuredHeight = useMemo(() => {
    const values = Object.values(effectiveSizes);
    if (values.length === 0) return FALLBACK_HEIGHT;
    return Math.max(...values.map(size => size.height));
  }, [effectiveSizes]);

  const galleryHeight = fixedHeight ?? measuredHeight;

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
    ({ item, index }: ListRenderItemInfo<string>) => {
      // Fall back to filling the page when a file could not be measured.
      const size = effectiveSizes[index] ?? { width: containerWidth, height: galleryHeight };
      return (
        <View
          style={{
            width: containerWidth,
            height: galleryHeight,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <AppImage
            imageRef={item}
            variant="full"
            usage="full"
            recyclingKey={`${entryId ?? 'gallery'}-${index}`}
            contentFit="contain"
            style={{ width: size.width, height: size.height, borderRadius: 10 }}
            priority={index === currentIndex ? 'high' : 'low'}
          />
        </View>
      );
    },
    [containerWidth, currentIndex, entryId, galleryHeight, effectiveSizes],
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
      style={[styles.container, { height: galleryHeight }]}
      // Only measures when the caller has not already told us the width.
      // Rounding stops a sub-pixel layout report from setting state, which
      // would re-render, re-measure and set it again.
      onLayout={
        fixedWidth !== undefined
          ? undefined
          : event => {
              const next = Math.round(event.nativeEvent.layout.width);
              setMeasuredWidth(previous => (previous === next ? previous : next));
            }
      }
    >
      {containerWidth > 0 && (
        <FlatList
          ref={listRef}
          data={imageRefs}
          horizontal
          showsHorizontalScrollIndicator={false}
          // A gallery sits inside the vertical entry list. Without the lock, a
          // drag that is mostly vertical but slightly sideways is claimed by
          // this scroller, and the page under the finger refuses to move.
          directionalLockEnabled
          snapToInterval={containerWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyExtractor={(item, index) => `${entryId ?? 'gallery'}-${index}-${item}`}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex > 0 ? initialIndex : undefined}
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
