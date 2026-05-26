import { type AsyncIterableSubject, type ContelloClient, createAsyncIterableSubject } from '@contello/client';
import { ProjectedLazyMap, type ReadonlyDeep } from 'projected';
import { wrap } from './diagnostics';
import { type StoreGetRoutesQuery, storeGetRoutesDocument } from './generated/graphql';
import { type LruCache, createLruCache } from './lru';
import type { ModelResolver } from './model-resolver';
import { type StoreRoute, mapRoute } from './routes-mapping';
import type { Created, LazyCacheOptions, RefreshEvent, RefreshKind } from './types';
import { createRefresher, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export type { StoreRoute, StoreRouteCustomHeader } from './routes-mapping';

export type RouteCollectionOptions = {
  cache?: LazyCacheOptions | undefined;
};

export type Routes = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  get(id: string): Promise<ReadonlyDeep<StoreRoute> | undefined>;
  get(ids: string[]): Promise<ReadonlyDeep<StoreRoute[]>>;
  getByPath(path: string): Promise<ReadonlyDeep<StoreRoute> | undefined>;
  getByPath(paths: string[]): Promise<ReadonlyDeep<StoreRoute[]>>;
  refresh(): void;
  clear(): void;
};

// cache key prefixes — short nullbyte-separated to allow slice(2) extraction without branching
const ID_PREFIX = '1\0';
const PATH_PREFIX = '2\0';

// private symbol used to tag each route with the projected cache key it was requested under,
// so the key() function can return the right prefixed key for projected to match results back
const CACHE_KEY = Symbol('cacheKey');

function collectRoutes(
  data: StoreGetRoutesQuery,
  keyFn: (route: StoreRoute) => string,
  resolver: ModelResolver,
): StoreRoute[] {
  return (data.contelloRoutes ?? []).reduce<StoreRoute[]>((acc, raw) => {
    if (!raw) {
      return acc;
    }

    const mapped = mapRoute(raw, resolver);

    if (mapped) {
      (mapped as Record<symbol, string>)[CACHE_KEY] = keyFn(mapped);
      acc.push(mapped);
    }

    return acc;
  }, []);
}

/**
 * cache wrapper that presents a unified `ID_PREFIX + id` / `PATH_PREFIX + path` key space
 * to ProjectedLazyMap while storing entries in the underlying LRU under ID_PREFIX keys only.
 *
 * path -> id resolution is handled internally via a pathToId map kept in sync with the LRU
 * (populated on set, cleared on natural LRU eviction via onEvict, and on explicit delete).
 */
function createRoutesCache(max: number, ttl: number | undefined): LruCache<string, StoreRoute> {
  const pathToId = new Map<string, string>();

  const lru = createLruCache<string, StoreRoute>({
    max,
    ttl,
    onEvict: (route) => {
      pathToId.delete(route.path);
    },
  });

  function resolveKey(key: string): string {
    if (key.startsWith(PATH_PREFIX)) {
      const id = pathToId.get(key.slice(2));

      if (id) {
        return ID_PREFIX + id;
      }

      return key; // propagate cache miss if path not found
    }

    return key;
  }

  return {
    has: (key) => lru.has(resolveKey(key)),
    get: (key) => lru.get(resolveKey(key)),

    set: (_key, value) => {
      // always normalise to ID_PREFIX in lru
      // regardless of which key projected passes in
      pathToId.set(value.path, value.id);
      lru.set(ID_PREFIX + value.id, value);
    },

    delete: (key) => {
      const resolved = resolveKey(key);
      const value = lru.get(resolved);

      if (value) {
        pathToId.delete(value.path);
      }

      lru.delete(resolved);
    },

    clear: () => {
      pathToId.clear();
      lru.clear();
    },

    keys: () => lru.keys(),
  };
}

export function createRoutesCollection(
  def: RouteCollectionOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<Routes> {
  const _def = {
    cache: {
      max: def?.cache?.max ?? 1000,
      ttl: resolveTtl(def?.cache?.ttl),
    },
  };

  const cache = createRoutesCache(_def.cache.max, _def.cache.ttl);

  const projected = new ProjectedLazyMap<string, StoreRoute>({
    key: (route) => (route as Record<symbol, string>)[CACHE_KEY] ?? ID_PREFIX + route.id,
    values: (prefixedKeys) =>
      wrap('routes', () => {
        const ids: string[] = [];
        const paths: string[] = [];

        for (const key of prefixedKeys) {
          const value = key.slice(2);

          if (key.startsWith(ID_PREFIX)) {
            ids.push(value);
          } else {
            paths.push(value);
          }
        }

        return Promise.all([
          ids.length > 0
            ? client
                .execute<StoreGetRoutesQuery>(storeGetRoutesDocument, { request: { ids } })
                .then((data) => collectRoutes(data, (r) => ID_PREFIX + r.id, resolver))
            : Promise.resolve([]),
          paths.length > 0
            ? client
                .execute<StoreGetRoutesQuery>(storeGetRoutesDocument, { request: { paths } })
                .then((data) => collectRoutes(data, (r) => PATH_PREFIX + r.path, resolver))
            : Promise.resolve([]),
        ]).then(([byIds, byPaths]) => [...byIds, ...byPaths]);
      }),
    cache,
  });

  const refresh$ = createAsyncIterableSubject<RefreshEvent>();

  function emit(ids: string[], kind: RefreshKind): void {
    refresh$.next({ ids, kind });
  }

  let lastRefreshKeys: string[] = [];

  const scheduleRefresh = createRefresher<RefreshKind>(
    async () => {
      lastRefreshKeys = cache.keys();

      if (lastRefreshKeys.length === 0) {
        return;
      }

      await projected.refresh(lastRefreshKeys);
    },
    (kind) => {
      if (lastRefreshKeys.length > 0) {
        emit(
          lastRefreshKeys.map((key) => key.slice(2)),
          kind,
        );
      }
    },
    () => {},
  );

  const unsubUpdates = updates$.subscribe((batch) => {
    const evicted: string[] = [];

    for (const event of batch.route) {
      const idKey = ID_PREFIX + event.id;

      if (event.mutation === 'delete') {
        cache.delete(idKey);
        evicted.push(event.id);
      } else {
        if (cache.has(idKey)) {
          cache.set(idKey, event.after);
        }

        evicted.push(event.after.path);
      }
    }

    if (evicted.length > 0) {
      emit(evicted, 'upstream-update');
    }
  });

  return {
    instance: {
      refresh$,

      get(idOrIds: string | string[]): any {
        if (Array.isArray(idOrIds)) {
          return projected.get(idOrIds.map((id) => ID_PREFIX + id));
        }

        return projected.get(ID_PREFIX + idOrIds);
      },

      getByPath(pathOrPaths: string | string[]): any {
        if (Array.isArray(pathOrPaths)) {
          return projected.get(pathOrPaths.map((p) => PATH_PREFIX + p));
        }

        return projected.get(PATH_PREFIX + pathOrPaths);
      },

      refresh() {
        scheduleRefresh('on-demand');
      },

      clear() {
        projected.clear();
      },
    },
    destroy() {
      unsubUpdates();
      refresh$.complete();
    },
  };
}
