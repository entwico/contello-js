import {
  BUILT_IN_MUTATIONS,
  type ContelloClient,
  type SourceMutationKind,
  createSourceMutation,
  createSourceMutationVariables,
  createSourceSubscription,
} from '@contello/client';
import { type MaybePromise, type ReadonlyDeep, maybeThen } from '@entwico/dash';
import { type AsyncIterableSubject, concatAsync, mapAsync, retryWithBackoff } from '@entwico/dash/async';
import { ProjectedMap } from '@entwico/projected';

import { type StoreRouteFragment, schema as storeSchema } from './generated/graphql';
import type { ModelResolver } from './model-resolver';
import { type StoreRoute, mapRoute } from './routes-mapping';
import { wrap } from './telemetry';
import type { CacheOptions, CollectionWrites, Created, RefreshEvent, RefreshKind, SyncCacheOptions } from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';
import { createWriteBuffer } from './write-buffer';

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

/**
 * `update` is not the patch a collection's is: `updateContelloRoute` is keyed by the `path` in its
 * input — there is no id — and it replaces the route, so a field left out is cleared, not kept.
 */
export type Routes<TWrites = unknown> = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>>;
  getByPath(path: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined>;
  getByPath(paths: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>>;
  refresh(): void;
} & CollectionWrites<StoreRoute, TWrites>;

export type RoutesSync<TWrites = unknown> = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<StoreRoute> | undefined;
  get(ids: readonly string[]): ReadonlyArray<ReadonlyDeep<StoreRoute>>;
  getByPath(path: string): ReadonlyDeep<StoreRoute> | undefined;
  getByPath(paths: readonly string[]): ReadonlyArray<ReadonlyDeep<StoreRoute>>;
  refresh(): void;
} & CollectionWrites<StoreRoute, TWrites>;

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

  // the built-in route source plus its fixed write bindings — `mutations` is constant for every
  // Contello schema, so the store carries it rather than depending on a regenerated bundle
  const routeSource = { ...storeSchema.sources.storeRoute, mutations: BUILT_IN_MUTATIONS.route };
  const routesSourceDoc = createSourceSubscription(routeSource);

  const writeBuffer = createWriteBuffer<StoreRouteFragment>();

  function fetchRoutes(ids: string[] | undefined): Promise<StoreRouteFragment[]> {
    return concatAsync(
      mapAsync(
        client.subscribe<{ source: StoreRouteFragment[] }>(routesSourceDoc, { ids }),
        (data) => data.source,
      ),
    );
  }

  async function fetchOrTakeWritten(ids: string[] | undefined): Promise<StoreRouteFragment[]> {
    // a full fetch is authoritative for every id, so nothing stays parked behind it
    if (ids === undefined) {
      writeBuffer.clear();

      return fetchRoutes(undefined);
    }

    const { written, missing } = writeBuffer.take(ids);

    if (missing.length === 0) {
      return written;
    }

    const fetched = await fetchRoutes(missing);

    return written.length === 0 ? fetched : [...written, ...fetched];
  }

  const projected = new ProjectedMap<string, StoreRoute>({
    key: (route) => route.id,
    values: (ids) =>
      wrap('routes', async () => {
        const rawItems = await fetchOrTakeWritten(ids);
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
            if (returnedIds.has(id)) {
              continue;
            }

            const oldPath = pathById.get(id);

            if (oldPath !== undefined) {
              idByPath.delete(oldPath);
              pathById.delete(id);
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
  });

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  function runFullRefresh(kind: RefreshKind): void {
    refreshByTtl.enqueue(() =>
      retryWithBackoff(async () => {
        const map = await projected.refresh();

        emit(map.keys().toArray(), kind);
        ttl.mark();
      }),
    );
  }

  function runPartialRefresh(refreshIds: string[], deletedIds: string[]): void {
    const changedIds = [...new Set([...refreshIds, ...deletedIds])];

    if (refreshIds.length === 0) {
      emit(changedIds, 'upstream-update');

      return;
    }

    // upstream is authoritative for these until the refetch lands — no local write may answer it
    const settled = writeBuffer.awaitingUpstream(refreshIds);

    void retryWithBackoff(async () => {
      await projected.refresh(refreshIds);
      emit(changedIds, 'upstream-update');
    }).finally(settled);
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
      writeBuffer.clear();
      projected.clear();

      return;
    }

    writeBuffer.release(deleted);

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

  function getByIds(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>> {
    return projected.get(ids);
  }

  function lookupByPathSingle(path: string): MaybePromise<ReadonlyDeep<StoreRoute> | undefined> {
    return maybeThen(ensureLoaded(), () => {
      const id = idByPath.get(path);

      return id === undefined ? undefined : projected.get(id);
    });
  }

  function lookupByPaths(paths: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreRoute>>> {
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

    return maybeThen(projected.getAllAsMap(), () => {});
  }

  async function runMutation(kind: SourceMutationKind, values: { input?: unknown; id?: string }): Promise<unknown> {
    const binding = routeSource.mutations?.[kind];

    if (!binding) {
      throw new Error(`@contello/store: routes cannot ${kind} — the schema exposes no ${kind} mutation for routes`);
    }

    const response = await client.execute<{ result: unknown }>(
      createSourceMutation(routeSource, kind),
      createSourceMutationVariables(binding, values),
    );

    if (response?.result === undefined || response.result === null) {
      throw new Error(`@contello/store: ${kind} on routes returned nothing`);
    }

    return response.result;
  }

  /** Takes a written route into the cache through the normal refresh path, keeping both indexes. */
  async function takeIntoCache(raw: StoreRouteFragment): Promise<ReadonlyDeep<StoreRoute>> {
    writeBuffer.park(raw.id, raw);

    let map;

    try {
      map = await projected.refresh([raw.id]);
    } finally {
      // a refresh that never ran leaves the route parked, so release what it did not consume
      writeBuffer.release([raw.id]);
    }

    emit([raw.id], 'write');

    const route = map.get(raw.id);

    if (!route) {
      throw new Error(
        `@contello/store: wrote route "${raw.id}" but it is not in the cache — ` +
        `its target may not have resolved, or a concurrent full refresh did not return it`,
      );
    }

    return route;
  }

  const writes = {
    async create(input: unknown): Promise<ReadonlyDeep<StoreRoute>> {
      return takeIntoCache((await runMutation('create', { input })) as StoreRouteFragment);
    },

    async update(input: unknown): Promise<ReadonlyDeep<StoreRoute>> {
      return takeIntoCache((await runMutation('update', { input })) as StoreRouteFragment);
    },

    async delete(id: string): Promise<void> {
      await runMutation('delete', { input: { id }, id });

      writeBuffer.release([id]);

      const oldPath = pathById.get(id);

      if (oldPath !== undefined) {
        idByPath.delete(oldPath);
        pathById.delete(id);
      }

      projected.delete([id]);
      emit([id], 'write');
    },
  };

  const instance: Routes = {
    ...writes,
    refresh$: channel.stream$,

    async load() {
      if (!loaded) {
        await projected.getAllAsMap();
      }
    },

    get(idOrIds: string | readonly string[]): any {
      return typeof idOrIds === 'string' ? getByIdSingle(idOrIds) : getByIds(idOrIds);
    },

    getByPath(pathOrPaths: string | readonly string[]): any {
      return typeof pathOrPaths === 'string' ? lookupByPathSingle(pathOrPaths) : lookupByPaths(pathOrPaths);
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
      throw new TypeError(`routes.${method}() is not initialized yet — call routes.load() first`);
    }

    return value;
  }

  return {
    instance: {
      ...base,
      get(idOrIds: string | readonly string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
      getByPath(pathOrPaths: string | readonly string[]): any {
        return assertSync(base.getByPath(pathOrPaths as string), 'getByPath');
      },
    },
    destroy,
  };
}
