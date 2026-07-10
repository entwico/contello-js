import { type ContelloClient, createSourceSubscription } from '@contello/client';
import type { ReadonlyDeep } from '@entwico/dash';
import { type AsyncIterableSubject, concatAsync, mapAsync } from '@entwico/dash/async';
import { ProjectedLazyMap } from '@entwico/projected';
import { type StoreRouteFragment, schema as storeSchema } from './generated/graphql';
import { type LruCache, createLruCache } from './lru';
import type { ModelResolver } from './model-resolver';
import { type StoreRoute, mapRoute } from './routes-mapping';
import { wrap } from './telemetry';
import type { Created, LazyCacheOptions, RefreshEvent, RefreshKind } from './types';
import { DEFAULT_LRU_MAX, createRefreshChannel, createRefresher, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export type { StoreRoute, StoreRouteCustomHeader } from './routes-mapping';

export type LazyRoutesOptions = {
  cache?: LazyCacheOptions | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type LazyRoutes = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  get(id: string): Promise<ReadonlyDeep<StoreRoute> | undefined>;
  get(ids: readonly string[]): Promise<ReadonlyDeep<StoreRoute[]>>;
  getByPath(path: string): Promise<ReadonlyDeep<StoreRoute> | undefined>;
  getByPath(paths: readonly string[]): Promise<ReadonlyDeep<StoreRoute[]>>;
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
  rawItems: StoreRouteFragment[],
  keyFn: (route: StoreRoute) => string,
  resolver: ModelResolver,
): StoreRoute[] {
  return rawItems.reduce<StoreRoute[]>((acc, raw) => {
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
  // reverse of pathToId, so a route whose path changed can have its previous
  // path entry removed (otherwise getByPath(oldPath) would resolve to the route
  // that no longer lives there)
  const idToPath = new Map<string, string>();

  const lru = createLruCache<string, StoreRoute>({
    max,
    ttl,
    onEvict: (route) => {
      pathToId.delete(route.path);
      idToPath.delete(route.id);
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
      const previousPath = idToPath.get(value.id);

      if (previousPath !== undefined && previousPath !== value.path) {
        pathToId.delete(previousPath);
      }

      pathToId.set(value.path, value.id);
      idToPath.set(value.id, value.path);
      lru.set(ID_PREFIX + value.id, value);
    },

    delete: (key) => {
      const resolved = resolveKey(key);
      const value = lru.get(resolved);

      if (value) {
        pathToId.delete(value.path);
        idToPath.delete(value.id);
      }

      lru.delete(resolved);
    },

    clear: () => {
      pathToId.clear();
      idToPath.clear();
      lru.clear();
    },

    keys: () => lru.keys(),
  };
}

export function createLazyRoutesCollection(
  def: LazyRoutesOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<LazyRoutes> {
  const _def = {
    cache: {
      max: def?.cache?.max ?? DEFAULT_LRU_MAX,
      ttl: resolveTtl(def?.cache?.ttl),
    },
  };

  const cache = createRoutesCache(_def.cache.max, _def.cache.ttl);

  const routesSourceDoc = createSourceSubscription(storeSchema.sources.storeRoute);

  function fetchRoutes(vars: { ids?: string[]; paths?: string[] }): Promise<StoreRouteFragment[]> {
    return concatAsync(
      mapAsync(client.subscribe<{ source: StoreRouteFragment[] }>(routesSourceDoc, vars), (data) => data.source),
    );
  }

  const projected = new ProjectedLazyMap<string, StoreRoute>({
    key: (route) => (route as Record<symbol, string>)[CACHE_KEY] ?? ID_PREFIX + route.id,
    values: (prefixedKeys) =>
      wrap('routes', async () => {
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

        const [rawByIds, rawByPaths] = await Promise.all([
          ids.length > 0 ? fetchRoutes({ ids }) : Promise.resolve<StoreRouteFragment[]>([]),
          paths.length > 0 ? fetchRoutes({ paths }) : Promise.resolve<StoreRouteFragment[]>([]),
        ]);

        const byIds = collectRoutes(rawByIds, (r) => ID_PREFIX + r.id, resolver);
        const byPaths = collectRoutes(rawByPaths, (r) => PATH_PREFIX + r.path, resolver);

        return [...byIds, ...byPaths];
      }),
    cache,
  });

  const channel = createRefreshChannel<RefreshEvent>(def?.onRefresh);

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
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
      refresh$: channel.stream$,

      get(idOrIds: string | readonly string[]): any {
        if (Array.isArray(idOrIds)) {
          return projected.get(idOrIds.map((id) => ID_PREFIX + id));
        }

        return projected.get(ID_PREFIX + idOrIds);
      },

      getByPath(pathOrPaths: string | readonly string[]): any {
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
      channel.complete();
    },
  };
}
