import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * A deliberately small data cache (stale-while-revalidate) keyed by API path.
 * - useQuery(path) fetches once, shares results across components, refetches on invalidate().
 * - invalidate(prefix) refreshes every cached key that starts with prefix.
 */
interface Entry {
  data: unknown;
  error: Error | null;
  loading: boolean;
  promise: Promise<void> | null;
  fetchedAt: number;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, fn: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

function load(key: string): Promise<void> {
  const existing = cache.get(key);
  if (existing?.promise) return existing.promise;
  const entry: Entry = existing ?? { data: undefined, error: null, loading: true, promise: null, fetchedAt: 0 };
  entry.loading = true;
  const promise = api
    .get<unknown>(key)
    .then((data) => {
      entry.data = data;
      entry.error = null;
    })
    .catch((err: Error) => {
      entry.error = err;
    })
    .finally(() => {
      entry.loading = false;
      entry.promise = null;
      entry.fetchedAt = Date.now();
      cache.set(key, { ...entry });
      emit(key);
    });
  entry.promise = promise;
  cache.set(key, entry);
  return promise;
}

export function invalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      if (listeners.get(key)?.size) void load(key);
      else cache.delete(key);
    }
  }
}

export function setQueryData<T>(key: string, data: T): void {
  const entry = cache.get(key) ?? { data: undefined, error: null, loading: false, promise: null, fetchedAt: Date.now() };
  cache.set(key, { ...entry, data, error: null });
  emit(key);
}

export function clearQueryCache(): void {
  cache.clear();
}

const EMPTY: Entry = { data: undefined, error: null, loading: false, promise: null, fetchedAt: 0 };

export function useQuery<T>(key: string | null, opts: { refreshMs?: number } = {}) {
  const snapshot = useSyncExternalStore(
    useCallback((fn: () => void) => (key ? subscribe(key, fn) : () => {}), [key]),
    () => (key ? (cache.get(key) ?? EMPTY) : EMPTY),
  );

  useEffect(() => {
    if (!key) return;
    const entry = cache.get(key);
    if (!entry || (!entry.promise && entry.fetchedAt === 0) || Date.now() - entry.fetchedAt > 30_000) void load(key);
  }, [key]);

  const refreshRef = useRef(opts.refreshMs);
  refreshRef.current = opts.refreshMs;
  useEffect(() => {
    if (!key || !opts.refreshMs) return;
    const t = setInterval(() => void load(key), opts.refreshMs);
    return () => clearInterval(t);
  }, [key, opts.refreshMs]);

  return {
    data: snapshot.data as T | undefined,
    error: snapshot.error,
    loading: snapshot.loading || (key !== null && snapshot.fetchedAt === 0 && !snapshot.error),
    refresh: useCallback(() => (key ? load(key) : Promise.resolve()), [key]),
  };
}
