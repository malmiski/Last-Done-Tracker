/**
 * Paginated entry lists.
 *
 * The whole point: an activity with 2,000 entries should cost the same as one
 * with 20 until you scroll. Entries arrive one page at a time, search is pushed
 * down into SQL (or an IndexedDB cursor on web), and image *references* — never
 * image data — travel with each row.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityEntry, Tag } from '../data/activity-details';
import * as database from '../utils/database';
import { loadDimensionsFor } from '../utils/imageDimensions';

export const PAGE_SIZE = 30;

/**
 * Pull in whatever is known about a page's images.
 *
 * Done once per page rather than per row, so the list can work out how tall
 * each row will be before it renders any of them. Deliberately not awaited by
 * the caller: entries should appear as soon as they load, and the sizes arrive
 * a moment later to refine the layout.
 */
const prefetchDimensions = (entries: ListEntry[]) => {
  const refs = entries.flatMap(entry =>
    entry.images?.length ? entry.images : (entry.thumbnails ?? []),
  );
  if (refs.length > 0) void loadDimensionsFor(refs);
};

/** Debounce search so typing does not fire a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

export type ListEntry = ActivityEntry & { activityId: string };

interface UseEntriesResult {
  entries: ListEntry[];
  total: number;
  windowOffset: number;
  loading: boolean;
  loadingMore: boolean;
  loadingPrevious: boolean;
  hasMore: boolean;
  hasPrevious: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  jumpToBottom: (onBeforeSwap?: () => Promise<void>) => Promise<void>;
  jumpToTop: (onBeforeSwap?: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  removeEntry: (entryId: string) => void;
}

export const useEntries = (
  activityId: string | undefined,
  { search = '', pageSize = PAGE_SIZE, filterStartDate, filterEndDate, filterTagIds, filterTagMode = 'OR' }: { search?: string; pageSize?: number; filterStartDate?: number; filterEndDate?: number; filterTagIds?: string[]; filterTagMode?: 'AND' | 'OR' } = {},
): UseEntriesResult => {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [windowOffset, setWindowOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Guards against a slow first page overwriting a newer search's results.
  const requestId = useRef(0);
  const offsetRef = useRef(0);
  const windowOffsetRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  /** Read a window of `limit` rows starting at `startOffset`. */
  const loadWindow = useCallback(
    async (limit: number, startOffset = 0) => {
      if (!activityId) {
        setEntries([]);
        setTotal(0);
        setWindowOffset(0);
        windowOffsetRef.current = 0;
        offsetRef.current = 0;
        setLoading(false);
        return;
      }

      const token = ++requestId.current;
      setLoading(true);
      try {
        const [page, count] = await Promise.all([
          database.getEntriesPage(activityId, { limit, offset: startOffset, search: debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode }),
          database.countEntries(activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode),
        ]);
        if (requestId.current !== token) return;
        windowOffsetRef.current = startOffset;
        offsetRef.current = startOffset + page.length;
        setWindowOffset(startOffset);
        setEntries(page);
        setTotal(count);
        prefetchDimensions(page);
      } catch (error) {
        console.error('Failed to load entries', error);
        if (requestId.current === token) {
          setEntries([]);
          setTotal(0);
          setWindowOffset(0);
          windowOffsetRef.current = 0;
          offsetRef.current = 0;
        }
      } finally {
        if (requestId.current === token) setLoading(false);
      }
    },
    [activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode],
  );

  const loadFirstPage = useCallback(() => loadWindow(pageSize, 0), [loadWindow, pageSize]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  /**
   * Re-read what is currently on screen, rather than collapsing back to the
   * first page.
   *
   * This runs whenever the list regains focus. Reloading a single page after
   * the user had scrolled through several thousand rows discarded them all:
   * the content became a fraction of its height, the scroll position was
   * clamped to fit, and the user was dumped near the top with no idea why.
   */
  const refresh = useCallback(
    () =>
      loadWindow(
        Math.max(pageSize, offsetRef.current - windowOffsetRef.current),
        windowOffsetRef.current,
      ),
    [loadWindow, pageSize],
  );

  const loadMore = useCallback(() => {
    if (!activityId || loading || loadingMore) return;
    if (offsetRef.current >= total) return;

    const token = requestId.current;
    setLoadingMore(true);
    void (async () => {
      try {
        const page = await database.getEntriesPage(activityId, {
          limit: pageSize,
          offset: offsetRef.current,
          search: debouncedSearch,
          filterStartDate,
          filterEndDate,
          filterTagIds,
          filterTagMode,
        });
        // A search or refresh started while this page was in flight.
        if (requestId.current !== token) return;
        offsetRef.current += page.length;
        prefetchDimensions(page);
        setEntries(previous => {
          // Defend against duplicates if rows shifted between pages.
          const seen = new Set(previous.map(entry => entry.id));
          return [...previous, ...page.filter(entry => !seen.has(entry.id))];
        });
      } catch (error) {
        console.error('Failed to load more entries', error);
      } finally {
        if (requestId.current === token) setLoadingMore(false);
      }
    })();
  }, [activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode, loading, loadingMore, pageSize, total]);

  /**
   * Prepend the preceding page of entries when scrolling upward from a bottom
   * or middle window (`windowOffset > 0`).
   */
  const loadPrevious = useCallback(() => {
    if (!activityId || loading || loadingPrevious) return;
    if (windowOffsetRef.current <= 0) return;

    const token = requestId.current;
    const currentStart = windowOffsetRef.current;
    const nextStart = Math.max(0, currentStart - pageSize);
    const fetchLimit = currentStart - nextStart;
    if (fetchLimit <= 0) return;

    setLoadingPrevious(true);
    void (async () => {
      try {
        const page = await database.getEntriesPage(activityId, {
          limit: fetchLimit,
          offset: nextStart,
          search: debouncedSearch,
          filterStartDate,
          filterEndDate,
          filterTagIds,
          filterTagMode,
        });
        if (requestId.current !== token) return;
        windowOffsetRef.current = nextStart;
        setWindowOffset(nextStart);
        prefetchDimensions(page);
        setEntries(previous => {
          const seen = new Set(previous.map(entry => entry.id));
          return [...page.filter(entry => !seen.has(entry.id)), ...previous];
        });
      } catch (error) {
        console.error('Failed to load previous entries', error);
      } finally {
        if (requestId.current === token) setLoadingPrevious(false);
      }
    })();
  }, [activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode, loading, loadingPrevious, pageSize]);

  /**
   * Jump directly to the oldest ("very first") window of entries without loading
   * all intermediate pages into memory. Loads up to 2 pages so there is plenty
   * of scroll runway above the bottom item for smooth landing and upward
   * scrolling.
   */
  const jumpToBottom = useCallback(
    async (onBeforeSwap?: () => Promise<void>) => {
      if (!activityId) return;
      const token = ++requestId.current;
      setLoadingMore(false);
      setLoadingPrevious(false);
      const windowSize = pageSize * 2;
      const startOffset = Math.max(0, total - windowSize);
      const fetchLimit = Math.max(pageSize, total - startOffset);
      try {
        const [page] = await Promise.all([
          database.getEntriesPage(activityId, {
            limit: fetchLimit,
            offset: startOffset,
            search: debouncedSearch,
            filterStartDate,
            filterEndDate,
            filterTagIds,
            filterTagMode,
          }),
          onBeforeSwap ? onBeforeSwap() : Promise.resolve(),
        ]);
        if (requestId.current !== token) return;
        prefetchDimensions(page);
        windowOffsetRef.current = startOffset;
        offsetRef.current = startOffset + page.length;
        setWindowOffset(startOffset);
        setEntries(page);
      } catch (error) {
        console.error('Failed to jump to bottom entries', error);
      }
    },
    [activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode, pageSize, total],
  );

  /**
   * Return to the newest page of entries at offset 0.
   */
  const jumpToTop = useCallback(
    async (onBeforeSwap?: () => Promise<void>) => {
      if (!activityId) return;
      const token = ++requestId.current;
      setLoadingMore(false);
      setLoadingPrevious(false);
      try {
        const [page] = await Promise.all([
          database.getEntriesPage(activityId, {
            limit: pageSize * 2,
            offset: 0,
            search: debouncedSearch,
            filterStartDate,
            filterEndDate,
            filterTagIds,
            filterTagMode,
          }),
          onBeforeSwap ? onBeforeSwap() : Promise.resolve(),
        ]);
        if (requestId.current !== token) return;
        prefetchDimensions(page);
        windowOffsetRef.current = 0;
        offsetRef.current = page.length;
        setWindowOffset(0);
        setEntries(page);
      } catch (error) {
        console.error('Failed to jump to top entries', error);
      }
    },
    [activityId, debouncedSearch, filterStartDate, filterEndDate, filterTagIds, filterTagMode, pageSize],
  );

  /** Drop a row locally without refetching the whole list. */
  const removeEntry = useCallback((entryId: string) => {
    setEntries(previous => {
      const next = previous.filter(entry => entry.id !== entryId);
      if (next.length !== previous.length) {
        offsetRef.current = Math.max(windowOffsetRef.current, offsetRef.current - 1);
        setTotal(count => Math.max(0, count - 1));
      }
      return next;
    });
  }, []);

  return {
    entries,
    total,
    windowOffset,
    loading,
    loadingMore,
    loadingPrevious,
    hasMore: windowOffset + entries.length < total,
    hasPrevious: windowOffset > 0,
    loadMore,
    loadPrevious,
    jumpToBottom,
    jumpToTop,
    refresh,
    removeEntry,
  };
};

/**
 * One entry, loaded on demand. This is the only place image references for a
 * specific row are fetched, and it reads exactly one row.
 */
export const useEntry = (entryId: string | undefined) => {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!entryId) {
      setEntry(null);
      setLoading(false);
      return;
    }
    const token = ++requestId.current;
    setLoading(true);
    try {
      const result = await database.getEntryById(entryId);
      if (requestId.current === token) setEntry(result);
    } catch (error) {
      console.error('Failed to load entry', error);
      if (requestId.current === token) setEntry(null);
    } finally {
      if (requestId.current === token) setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entry, loading, reload: load };
};

/**
 * Entries carrying any of the selected tags, paginated across all activities.
 */
export const useEntriesByTags = (
  tagIds: string[],
  { pageSize = PAGE_SIZE }: { pageSize?: number } = {},
) => {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [windowOffset, setWindowOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingPrevious, setLoadingPrevious] = useState(false);

  const requestId = useRef(0);
  const offsetRef = useRef(0);
  const windowOffsetRef = useRef(0);
  // Array identity changes every render; compare by value instead.
  const key = tagIds.slice().sort().join(',');

  const loadFirstPage = useCallback(async () => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setEntries([]);
      setTotal(0);
      setWindowOffset(0);
      windowOffsetRef.current = 0;
      offsetRef.current = 0;
      return;
    }

    const token = ++requestId.current;
    setLoading(true);
    try {
      const [page, count] = await Promise.all([
        database.getEntriesByTags(ids, { limit: pageSize, offset: 0 }),
        database.countEntriesByTags(ids),
      ]);
      if (requestId.current !== token) return;
      windowOffsetRef.current = 0;
      offsetRef.current = page.length;
      setWindowOffset(0);
      setEntries(page);
      setTotal(count);
    } catch (error) {
      console.error('Failed to load tagged entries', error);
    } finally {
      if (requestId.current === token) setLoading(false);
    }
  }, [key, pageSize]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0 || loading || loadingMore) return;
    if (offsetRef.current >= total) return;

    const token = requestId.current;
    setLoadingMore(true);
    void (async () => {
      try {
        const page = await database.getEntriesByTags(ids, {
          limit: pageSize,
          offset: offsetRef.current,
        });
        if (requestId.current !== token) return;
        offsetRef.current += page.length;
        setEntries(previous => {
          const seen = new Set(previous.map(entry => entry.id));
          return [...previous, ...page.filter(entry => !seen.has(entry.id))];
        });
      } catch (error) {
        console.error('Failed to load more tagged entries', error);
      } finally {
        if (requestId.current === token) setLoadingMore(false);
      }
    })();
  }, [key, loading, loadingMore, pageSize, total]);

  const loadPrevious = useCallback(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0 || loading || loadingPrevious) return;
    if (windowOffsetRef.current <= 0) return;

    const token = requestId.current;
    const currentStart = windowOffsetRef.current;
    const nextStart = Math.max(0, currentStart - pageSize);
    const fetchLimit = currentStart - nextStart;
    if (fetchLimit <= 0) return;

    setLoadingPrevious(true);
    void (async () => {
      try {
        const page = await database.getEntriesByTags(ids, {
          limit: fetchLimit,
          offset: nextStart,
        });
        if (requestId.current !== token) return;
        windowOffsetRef.current = nextStart;
        setWindowOffset(nextStart);
        setEntries(previous => {
          const seen = new Set(previous.map(entry => entry.id));
          return [...page.filter(entry => !seen.has(entry.id)), ...previous];
        });
      } catch (error) {
        console.error('Failed to load previous tagged entries', error);
      } finally {
        if (requestId.current === token) setLoadingPrevious(false);
      }
    })();
  }, [key, loading, loadingPrevious, pageSize]);

  const jumpToBottom = useCallback(
    async (onBeforeSwap?: () => Promise<void>) => {
      const ids = key ? key.split(',') : [];
      if (ids.length === 0) return;
      const token = ++requestId.current;
      setLoadingMore(false);
      setLoadingPrevious(false);
      const windowSize = pageSize * 2;
      const startOffset = Math.max(0, total - windowSize);
      const fetchLimit = Math.max(pageSize, total - startOffset);
      try {
        const [page] = await Promise.all([
          database.getEntriesByTags(ids, { limit: fetchLimit, offset: startOffset }),
          onBeforeSwap ? onBeforeSwap() : Promise.resolve(),
        ]);
        if (requestId.current !== token) return;
        windowOffsetRef.current = startOffset;
        offsetRef.current = startOffset + page.length;
        setWindowOffset(startOffset);
        setEntries(page);
      } catch (error) {
        console.error('Failed to jump to bottom tagged entries', error);
      }
    },
    [key, pageSize, total],
  );

  const jumpToTop = useCallback(
    async (onBeforeSwap?: () => Promise<void>) => {
      const ids = key ? key.split(',') : [];
      if (ids.length === 0) return;
      const token = ++requestId.current;
      setLoadingMore(false);
      setLoadingPrevious(false);
      try {
        const [page] = await Promise.all([
          database.getEntriesByTags(ids, { limit: pageSize * 2, offset: 0 }),
          onBeforeSwap ? onBeforeSwap() : Promise.resolve(),
        ]);
        if (requestId.current !== token) return;
        windowOffsetRef.current = 0;
        offsetRef.current = page.length;
        setWindowOffset(0);
        setEntries(page);
      } catch (error) {
        console.error('Failed to jump to top tagged entries', error);
      }
    },
    [key, pageSize],
  );

  const removeEntry = useCallback((entryId: string) => {
    setEntries(previous => previous.filter(entry => entry.id !== entryId));
    setTotal(count => Math.max(0, count - 1));
  }, []);

  return {
    entries,
    total,
    windowOffset,
    loading,
    loadingMore,
    loadingPrevious,
    hasMore: windowOffset + entries.length < total,
    hasPrevious: windowOffset > 0,
    loadMore,
    loadPrevious,
    jumpToBottom,
    jumpToTop,
    refresh: loadFirstPage,
    removeEntry,
  };
};

/** Timestamps only, for the graph. Never touches image columns. */
export const useEntryDates = (activityId: string | undefined) => {
  const [dates, setDates] = useState<{ id: string; startDate: Date; endDate: Date }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!activityId) {
      setDates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    database
      .getEntryDates(activityId)
      .then(result => {
        if (!cancelled) setDates(result);
      })
      .catch(error => console.error('Failed to load entry dates', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  return { dates, loading };
};

export type { Tag };
