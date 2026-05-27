import {
  type AsyncIterableSubject,
  type ContelloClient,
  collectAsync,
  createSourceSubscription,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep, maybeThen } from 'projected';

import { wrap } from './diagnostics';
import { type StoreRouteFragment, schema as storeSchema } from './generated/graphql';
import type { ModelResolver } from './model-resolver';
import { type StoreRoute, mapRoute } from './routes-mapping';
import type { CacheOptions, Created, RefreshEvent, RefreshKind, SyncCacheOptions } from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export type RoutesOptions = {
  cache?: CacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type RoutesSyncOptions = {
  cache?: SyncCacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type Routes = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined>;
  get(ids: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>>;
  getByPath(path: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined>;
  getByPath(paths: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>>;
  refresh(): void;
};

export type RoutesSync = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<StoreRoute> | undefined;
  get(ids: string[]): ReadonlyArray<ReadonlyDeep<StoreRoute>>;
  getByPath(path: string): ReadonlyDeep<StoreRoute> | undefined;
  getByPath(paths: string[]): ReadonlyArray<ReadonlyDeep<StoreRoute>>;
  refresh(): void;
};

export function createRoutesCollection(
  options: RoutesOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<Routes> {
  const opts = options ?? {};
  const cache = {
    ttl: resolveTtl(opts.cache?.ttl),
    eviction: opts.cache?.eviction ?? 'refresh',
  } as const;

  const channel = createRefreshChannel<RefreshEvent>(opts.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: cache.ttl, run: () => runFullRefresh('ttl') });

  // id ↔ path indexes — kept in sync with `projected` by the values callback.
  // any route lookup by path resolves to an id, then the value comes from `projected`.
  const pathById = new Map<string, string>();
  const idByPath = new Map<string, string>();
  let loaded = false;

  const routesSourceDoc = createSourceSubscription(storeSchema.sources.storeRoute);

  const projected = new ProjectedMap<string, StoreRoute>({
    key: (route) => route.id,
    values: (ids) =>
      wrap('routes', () =>
        collectAsync(
          mapAsync(client.subscribe<{ source: StoreRouteFragment[] }>(routesSourceDoc, { ids }), (data) => data.source),
        ).then((rawItems) => {
          const items = rawItems.reduce<StoreRoute[]>((acc, raw) => {
            const mapped = mapRoute(raw, resolver);

            if (mapped) {
              acc.push(mapped);
            }

            return acc;
          }, []);

          if (ids === undefined) {
            pathById.clear();
            idByPath.clear();

            for (const r of items) {
              pathById.set(r.id, r.path);
              idByPath.set(r.path, r.id);
            }

            if (!loaded) {
              loaded = true;
              ttl.mark();
              opts.onLoad?.(items.map((r) => r.id));
            }
          } else {
            const returnedIds = new Set(items.map((r) => r.id));

            // requested ids missing from the response = deleted; drop their path entries
            for (const id of ids) {
              if (!returnedIds.has(id)) {
                const oldPath = pathById.get(id);

                if (oldPath !== undefined) {
                  idByPath.delete(oldPath);
                  pathById.delete(id);
                }
              }
            }

            for (const r of items) {
              const oldPath = pathById.get(r.id);

              if (oldPath !== undefined && oldPath !== r.path) {
                idByPath.delete(oldPath);
              }

              pathById.set(r.id, r.path);
              idByPath.set(r.path, r.id);
            }
          }

          return items;
        }),
      ),
  });

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  function runFullRefresh(kind: RefreshKind): void {
    refreshByTtl.enqueue(() =>
      runWithBackoff(() =>
        projected.refresh().then((map) => {
          emit([...map.keys()], kind);
          ttl.mark();
        }),
      ),
    );
  }

  function runPartialRefresh(refreshIds: string[], deletedIds: string[]): void {
    const changedIds = [...new Set([...refreshIds, ...deletedIds])];

    if (refreshIds.length === 0) {
      emit(changedIds, 'upstream-update');

      return;
    }

    void runWithBackoff(() =>
      projected.refresh(refreshIds).then(() => {
        emit(changedIds, 'upstream-update');
      }),
    );
  }

  const unsubUpdates = updates$.subscribe((batch) => {
    if (!loaded || batch.route.length === 0) {
      return;
    }

    const deleted: string[] = [];
    const upserted = new Set<string>();

    for (const event of batch.route) {
      if (event.mutation === 'delete') {
        deleted.push(event.id);
      } else {
        upserted.add(event.id);
      }
    }

    if (cache.eviction === 'clear') {
      pathById.clear();
      idByPath.clear();
      projected.clear();

      return;
    }

    for (const id of deleted) {
      const oldPath = pathById.get(id);

      if (oldPath !== undefined) {
        idByPath.delete(oldPath);
        pathById.delete(id);
      }
    }

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    runPartialRefresh([...upserted], deleted);
  });

  function getByIdSingle(id: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined> {
    return projected.get(id);
  }

  function getByIds(ids: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>> {
    return projected.get(ids);
  }

  function lookupByPathSingle(path: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined> {
    return maybeThen(ensureLoaded(), () => {
      const id = idByPath.get(path);

      return id === undefined ? undefined : projected.get(id);
    });
  }

  function lookupByPaths(paths: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>> {
    return maybeThen(ensureLoaded(), () => {
      const ids: string[] = [];

      for (const p of paths) {
        const id = idByPath.get(p);

        if (id !== undefined) {
          ids.push(id);
        }
      }

      return projected.get(ids);
    });
  }

  function ensureLoaded(): MaybePromise<void> {
    if (loaded) {
      return undefined;
    }

    return maybeThen(projected.getAllAsMap(), () => undefined);
  }

  const instance: Routes = {
    refresh$: channel.stream$,

    async load() {
      if (!loaded) {
        await projected.getAllAsMap();
      }
    },

    get(idOrIds: string | string[]): any {
      return Array.isArray(idOrIds) ? getByIds(idOrIds) : getByIdSingle(idOrIds);
    },

    getByPath(pathOrPaths: string | string[]): any {
      return Array.isArray(pathOrPaths) ? lookupByPaths(pathOrPaths) : lookupByPathSingle(pathOrPaths);
    },

    refresh() {
      runFullRefresh('on-demand');
    },
  };

  return {
    instance,
    destroy() {
      unsubUpdates();
      ttl.clear();
      channel.complete();
    },
  };
}

export function createRoutesSyncCollection(
  options: RoutesSyncOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<RoutesSync> {
  const { instance: base, destroy } = createRoutesCollection(options, client, updates$, resolver, refreshByTtl);

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new Error(`routes.${method}() is not initialized yet — call routes.load() first`);
    }

    return value;
  }

  return {
    instance: {
      ...base,
      get(idOrIds: string | string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
      getByPath(pathOrPaths: string | string[]): any {
        return assertSync(base.getByPath(pathOrPaths as string), 'getByPath');
      },
    },
    destroy,
  };
}
