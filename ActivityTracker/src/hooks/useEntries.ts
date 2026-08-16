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

export const PAGE_SIZE = 30;

/** Debounce search so typing does not fire a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

export type ListEntry = ActivityEntry & { activityId: string };

interface UseEntriesResult {
  entries: ListEntry[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  removeEntry: (entryId: string) => void;
}

export const useEntries = (
  activityId: string | undefined,
  { search = '', pageSize = PAGE_SIZE }: { search?: string; pageSize?: number } = {},
): UseEntriesResult => {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Guards against a slow first page overwriting a newer search's results.
  const requestId = useRef(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const loadFirstPage = useCallback(async () => {
    if (!activityId) {
      setEntries([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const token = ++requestId.current;
    setLoading(true);
    try {
      const [page, count] = await Promise.all([
        database.getEntriesPage(activityId, { limit: pageSize, offset: 0, search: debouncedSearch }),
        database.countEntries(activityId, debouncedSearch),
      ]);
      if (requestId.current !== token) return;
      offsetRef.current = page.length;
      setEntries(page);
      setTotal(count);
    } catch (error) {
      console.error('Failed to load entries', error);
      if (requestId.current === token) {
        setEntries([]);
        setTotal(0);
      }
    } finally {
      if (requestId.current === token) setLoading(false);
    }
  }, [activityId, debouncedSearch, pageSize]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

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
        });
        // A search or refresh started while this page was in flight.
        if (requestId.current !== token) return;
        offsetRef.current += page.length;
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
  }, [activityId, debouncedSearch, loading, loadingMore, pageSize, total]);

  /** Drop a row locally without refetching the whole list. */
  const removeEntry = useCallback((entryId: string) => {
    setEntries(previous => {
      const next = previous.filter(entry => entry.id !== entryId);
      if (next.length !== previous.length) {
        offsetRef.current = Math.max(0, offsetRef.current - 1);
        setTotal(count => Math.max(0, count - 1));
      }
      return next;
    });
  }, []);

  return {
    entries,
    total,
    loading,
    loadingMore,
    hasMore: entries.length < total,
    loadMore,
    refresh: loadFirstPage,
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
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const requestId = useRef(0);
  const offsetRef = useRef(0);
  // Array identity changes every render; compare by value instead.
  const key = tagIds.slice().sort().join(',');

  const loadFirstPage = useCallback(async () => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setEntries([]);
      setTotal(0);
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
      offsetRef.current = page.length;
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

  const removeEntry = useCallback((entryId: string) => {
    setEntries(previous => previous.filter(entry => entry.id !== entryId));
    setTotal(count => Math.max(0, count - 1));
  }, []);

  return {
    entries,
    total,
    loading,
    loadingMore,
    hasMore: entries.length < total,
    loadMore,
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
