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
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
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
/**
 * How many times a resolve is retried before the tile is left blank.
 *
 * A resolve can come back empty for a transient reason — a contended
 * IndexedDB read, say — and without a retry that tile stays blank for as long
 * as it remains mounted, because none of its inputs change afterwards. The
 * image's own onError cannot help here: there is no source to fail.
 */
const MAX_RESOLVE_ATTEMPTS = 4;

export const useImageUri = (
  imageRef?: string | null,
  variant: ImageVariant = 'full',
  /** Increment to force a fresh resolve with a full retry budget. */
  nudge = 0,
): string | null => {
  const [uri, setUri] = useState<string | null>(null);
  // Re-resolve when the store invalidates cached URLs, so this component can
  // never be left pointing at one that has been revoked.
  const [epoch, setEpoch] = useState(getCacheEpoch);
  // Incremented to re-run the resolve; the count itself lives in a ref so a
  // retry does not cause an extra render on its own.
  const [retryTick, setRetryTick] = useState(0);
  const attemptsRef = useRef(0);

  useEffect(() => subscribeToCacheEpoch(setEpoch), []);

  // Declared before the resolve effect so it runs first on any commit where
  // the target changed: a new image starts with a fresh retry budget.
  useEffect(() => {
    attemptsRef.current = 0;
  }, [imageRef, variant, epoch, nudge]);

  useEffect(() => {
    if (!isRenderable(imageRef)) {
      setUri(null);
      return;
    }

    let cancelled = false;
    let heldKey: string | null = null;
    let retryTimer: any;

    acquireImageUri(imageRef, variant)
      .then((resolved) => {
        if (cancelled) {
          // Unmounted while resolving — hand the hold straight back.
          releaseImageUri(resolved?.key ?? null);
          return;
        }

        if (!resolved) {
          setUri(null);
          attemptsRef.current += 1;
          if (attemptsRef.current < MAX_RESOLVE_ATTEMPTS) {
            // Backs off so a burst of contending reads has room to clear.
            retryTimer = setTimeout(
              () => setRetryTick(tick => tick + 1),
              120 * attemptsRef.current,
            );
          }
          return;
        }

        heldKey = resolved.key;
        setUri(resolved.uri);
      })
      .catch(() => {
        if (cancelled) return;
        setUri(null);
        attemptsRef.current += 1;
        if (attemptsRef.current < MAX_RESOLVE_ATTEMPTS) {
          retryTimer = setTimeout(
            () => setRetryTick(tick => tick + 1),
            120 * attemptsRef.current,
          );
        }
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      // Releasing lets the pool reclaim this URL once nothing else displays it.
      releaseImageUri(heldKey);
      heldKey = null;
    };
  }, [imageRef, variant, epoch, nudge, retryTick]);

  return uri;
};

/*
 * There used to be an IntersectionObserver here that held a tile's resolve
 * back until it came near the viewport, on the theory that react-native-web's
 * virtualisation is too weak to bound how many object URLs are alive at once.
 *
 * It has been removed. It was speculative, it was the least verifiable piece
 * of this component, and it was implicated in the recurring "thumbnails stay
 * blank until you switch size modes" bug: a tile whose observer never fired
 * had no input that could change afterwards, so it stayed blank forever, and
 * only a remount (which is what changing size mode causes) recovered it.
 *
 * What actually bounds memory is FlatList windowing, which decides what is
 * mounted at all, plus the reference-counted URL pool in imageStore.web,
 * which caps how many blobs are held and evicts the idle ones.
 */

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
  // Bumped when a rendered image fails to load, to re-resolve from scratch.
  const [nudge, setNudge] = useState(0);
  const uri = useImageUri(imageRef, variant, nudge);

  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  if (!source) {
    // Reserve the layout box so the list does not reflow when the image lands.
    // A pending resolve, a failed legacy image and a not-yet-migrated blob all
    // land here and look the same: an empty tile.
    const isPending = !isFailed(imageRef) && !isLegacyPlaceholder(imageRef);
    return (
      <View
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
      // Last-resort recovery. The pool should never hand out a dead URL now
      // that references are taken before it can be evicted, but a blank tile
      // is invisible and unrecoverable, so one retry is cheap insurance.
      onError={() => setNudge(previous => previous + 1)}
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
