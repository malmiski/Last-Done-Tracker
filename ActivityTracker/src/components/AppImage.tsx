/**
 * The single image component for the whole app.
 *
 * Why this exists:
 *  - `<Image source={{uri: 'data:image/jpeg;base64,...'}}>` from react-native
 *    decodes at full resolution and keys its cache on the entire base64 string.
 *    A 1600px photo shown in a 50pt tile still cost ~10MB of bitmap.
 *  - expo-image decodes to the *display* size (`allowDownscaling`), recycles
 *    bitmaps when `recyclingKey` changes, and lets us pick a cache policy per
 *    call site. The same 50pt tile now costs ~90KB.
 *
 * Callers pass a stored reference, not a URI. Resolution happens here, is
 * cancelled on unmount, and never puts image bytes on the JS heap.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image, ImageContentFit } from 'expo-image';
import { ImageVariant, isFailed, isLegacyPlaceholder, isRenderable } from '../utils/imageRef';
import {
  acquireImageUri,
  clearMemoryCache as clearStoreMemoryCache,
  getCacheEpoch,
  releaseImageUri,
  subscribeToCacheEpoch,
} from '../utils/imageStore';
import theme from '../theme/theme';

export interface AppImageProps {
  /** Stored reference: "img:<id>", legacy inline base64, or a placeholder. */
  imageRef?: string | null;
  variant?: ImageVariant;
  style?: StyleProp<any>;
  contentFit?: ImageContentFit;
  /**
   * Distinguishes cheap, frequently reused images (list thumbnails) from
   * expensive one-off ones (the full-screen gallery). Thumbnails stay in the
   * memory cache; full images are released as soon as they scroll away.
   */
  usage?: 'thumbnail' | 'full';
  /** Stable identity for bitmap recycling — usually the entry id plus index. */
  recyclingKey?: string;
  placeholderStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  onLoad?: (size: { width: number; height: number }) => void;
  priority?: 'low' | 'normal' | 'high';
}

/**
 * Resolve a ref to a renderable URI. Returns null while loading or when the ref
 * cannot be rendered (missing file, unmigrated oversized legacy blob).
 */
export const useImageUri = (
  imageRef?: string | null,
  variant: ImageVariant = 'full',
): string | null => {
  const [uri, setUri] = useState<string | null>(null);
  // Re-resolve when the store invalidates cached URLs, so this component can
  // never be left pointing at one that has been revoked.
  const [epoch, setEpoch] = useState(getCacheEpoch);

  useEffect(() => subscribeToCacheEpoch(setEpoch), []);

  useEffect(() => {
    if (!isRenderable(imageRef)) {
      setUri(null);
      return;
    }

    let cancelled = false;
    let heldKey: string | null = null;

    acquireImageUri(imageRef, variant)
      .then((resolved) => {
        if (cancelled) {
          // Unmounted while resolving — hand the hold straight back.
          releaseImageUri(resolved?.key ?? null);
          return;
        }
        heldKey = resolved?.key ?? null;
        setUri(resolved?.uri ?? null);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });

    return () => {
      cancelled = true;
      // Releasing lets the pool reclaim this URL once nothing else displays it.
      releaseImageUri(heldKey);
      heldKey = null;
    };
  }, [imageRef, variant, epoch]);

  return uri;
};

/**
 * Viewport gating for web.
 *
 * react-native-web's FlatList virtualisation is much weaker than the native
 * one, and on iOS WKWebView (Chrome and Safari both) a tab is killed well
 * before a native app would be. Holding image elements back until they are
 * close to the viewport is what keeps a long list survivable there. On native
 * this always returns true and costs nothing — FlatList already handles it.
 */
const useInViewport = (enabled: boolean) => {
  const [inViewport, setInViewport] = useState(!enabled);
  const nodeRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setInViewport(true);
      return;
    }

    const node = nodeRef.current;
    if (!node) {
      setInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // One-way: once shown, stay shown. Unmounting a visible image on
        // scroll-back causes flicker, and the object-URL LRU already bounds
        // how many decoded blobs can be alive at once.
        if (entry.isIntersecting) {
          setInViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px', threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return { inViewport, nodeRef };
};

const AppImageComponent: React.FC<AppImageProps> = ({
  imageRef,
  variant = 'full',
  style,
  contentFit = 'cover',
  usage = 'thumbnail',
  recyclingKey,
  placeholderStyle,
  accessibilityLabel,
  onLoad,
  priority,
}) => {
  const { inViewport, nodeRef } = useInViewport(Platform.OS === 'web');
  // Do not even resolve the blob until the tile is near the viewport: on web
  // resolving means creating an object URL, which pins the blob in memory.
  const uri = useImageUri(inViewport ? imageRef : null, variant);

  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  if (!source) {
    // Reserve the layout box so the list does not reflow when the image lands.
    // A pending resolve, an off-screen tile, a failed legacy image and a
    // not-yet-migrated blob all land here and look the same: an empty tile.
    const isPending = !isFailed(imageRef) && !isLegacyPlaceholder(imageRef);
    return (
      <View
        ref={nodeRef}
        style={[
          style,
          styles.placeholder,
          isPending ? styles.placeholderPending : styles.placeholderMissing,
          placeholderStyle,
        ]}
      />
    );
  }

  return (
    <Image
      source={source}
      style={style}
      contentFit={contentFit}
      accessibilityLabel={accessibilityLabel}
      recyclingKey={recyclingKey ?? imageRef ?? undefined}
      // Thumbnails are small and reused constantly while scrolling, so keeping
      // them in the memory cache is a win. Full-size images are large and
      // usually viewed once, so we let them go the moment they are recycled --
      // this is what stops a long gallery from accumulating bitmaps.
      cachePolicy={usage === 'thumbnail' ? 'memory-disk' : 'none'}
      // Decode to the layout size rather than the file's intrinsic size.
      allowDownscaling
      priority={priority ?? (usage === 'thumbnail' ? 'normal' : 'high')}
      transition={usage === 'thumbnail' ? 0 : 120}
      onLoad={
        onLoad
          ? (event: any) =>
              onLoad({ width: event?.source?.width ?? 0, height: event?.source?.height ?? 0 })
          : undefined
      }
    />
  );
};

const styles = StyleSheet.create({
  placeholder: {
    overflow: 'hidden',
  },
  placeholderPending: {
    backgroundColor: theme.colors.card,
  },
  placeholderMissing: {
    backgroundColor: 'transparent',
  },
});

/**
 * Drop decoded bitmaps that are no longer on screen. Called when leaving an
 * image-heavy screen and when the app is backgrounded, so a long browsing
 * session cannot ratchet memory upward.
 */
export const clearImageMemoryCache = async (): Promise<void> => {
  try {
    await Image.clearMemoryCache();
  } catch {
    /* best effort */
  }
  try {
    // On web this revokes pooled object URLs, which is what actually releases
    // the underlying blobs. On native it is a no-op.
    clearStoreMemoryCache();
  } catch {
    /* best effort */
  }
};

export const AppImage = React.memo(AppImageComponent);
export default AppImage;
