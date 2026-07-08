import {
  type AsyncIterableSubject,
  type ContelloClient,
  type SourceDef,
  collectAsync,
  createSourceSubscription,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep, maybeThen } from 'projected';
import { DependencyCollector } from './dependency-collector';
import type { ModelResolver } from './model-resolver';
import { wrap } from './telemetry';
import type {
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  Created,
  ExtractSourceResult,
  RefreshEvent,
  RefreshKind,
} from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

function fetchCollection<S extends SourceDef<string, 'entity'>>(
  source: S,
  client: ContelloClient<any>,
  ids: string[] | undefined,
): Promise<ExtractSourceResult<S>[]> {
  return collectAsync(
    mapAsync(
      client.subscribe<{ source: ExtractSourceResult<S>[] }>(createSourceSubscription(source), { ids }),
      (r) => r.source,
    ),
  );
}

export function createCollection<
  TSource extends SourceDef<TModels, 'entity'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<Collection<TMapped>> {
  const opts = options ?? {};
  const mapFn = opts.map ?? ((item: ExtractSourceResult<TSource>) => item as unknown as TMapped);
  const _def = {
    name: opts.name ?? source.__model,
    model: source.__model,
    cache: {
      ttl: resolveTtl(opts.cache?.ttl),
      eviction: opts.cache?.eviction ?? 'refresh',
    },
  };
  const dependencyCollector = new DependencyCollector<string, TModels>(_def.model, resolver);
  const channel = createRefreshChannel<RefreshEvent>(opts.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: _def.cache.ttl, run: () => runFullRefresh('ttl') });
  let loaded = false;

  const projected = new ProjectedMap<string, TMapped>({
    key: (item) => item.id,
    values: (ids) =>
      wrap(`collection:${_def.name}`, () =>
        maybeThen(fetchCollection(source, client, ids), async (rawItems) => {
          // eslint-disable-next-line @eslint-react/naming-convention-context-name -- `createContext` here is DependencyCollector's method, not React's; this is a non-React module
          const items = await Promise.all(
            rawItems.map((item) =>
              Promise.resolve(
                dependencyCollector.createContext((ref, register) =>
                  maybeThen(mapFn(item, ref), (mapped) => {
                    register(mapped.id);

                    return mapped;
                  }),
                ),
              ),
            ),
          );

          if (ids === undefined) {
            dependencyCollector.retainOnly(new Set(items.map((item) => item.id)));

            // start tracking refresh by ttl on first successful full fetch
            if (!loaded) {
              loaded = true;
              ttl.mark();
              opts.onLoad?.(items.map((item) => item.id));
            }
          } else {
            const returnedIds = new Set(items.map((item) => item.id));

            for (const id of ids) {
              if (!returnedIds.has(id)) {
                dependencyCollector.removeItem(id);
              }
            }
          }

          return items;
        }),
      ),
    sort: opts.sort,
  });

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  function runFullRefresh(kind: RefreshKind): void {
    refreshByTtl.enqueue(() =>
      runWithBackoff(async () => {
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

    void runWithBackoff(async () => {
      await projected.refresh(refreshIds);
      emit(changedIds, 'upstream-update');
    });
  }

  const unsubUpdates = updates$.subscribe((batch) => {
    if (!loaded) {
      return;
    }

    const ownEvents = batch.entity.get(_def.model) ?? [];
    const deleted: string[] = [];
    const upserted = new Set<string>();

    for (const event of ownEvents) {
      if (event.mutation === 'delete') {
        deleted.push(event.id);
      } else {
        upserted.add(event.id);
      }
    }

    const depAffected = new Set<string>();

    for (const event of batch.events) {
      for (const id of dependencyCollector.getAffectedKeys(event)) {
        depAffected.add(id);
      }
    }

    if (deleted.length === 0 && upserted.size === 0 && depAffected.size === 0) {
      return;
    }

    if (_def.cache.eviction === 'clear') {
      dependencyCollector.clear();
      projected.clear();

      return;
    }

    for (const id of deleted) {
      dependencyCollector.removeItem(id);
    }

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    const refreshIds = upserted.union(depAffected);

    for (const id of deleted) {
      refreshIds.delete(id);
    }

    runPartialRefresh([...refreshIds], deleted);
  });

  const instance: Collection<TMapped> = {
    name: _def.name,
    refresh$: channel.stream$,

    get(idOrIds: string | readonly string[]): any {
      return projected.get(idOrIds as string);
    },

    getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<TMapped>>> {
      return projected.getAll();
    },

    refresh() {
      runFullRefresh('on-demand');
    },

    async load() {
      if (!loaded) {
        await projected.getAllAsMap();
      }
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

export function createCollectionSync<
  TSource extends SourceDef<TModels, 'entity'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<CollectionSync<TMapped>> {
  const { instance: base, destroy } = createCollection<TSource, TMapped, TModels>(
    source,
    options,
    client,
    updates$,
    resolver,
    refreshByTtl,
  );

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new TypeError(`collection "${base.name}".${method}() is not initialized yet — call collection.load() first`);
    }

    return value;
  }

  return {
    instance: {
      ...base,
      get(idOrIds: string | readonly string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
      getAll(): ReadonlyArray<ReadonlyDeep<TMapped>> {
        return assertSync(base.getAll(), 'getAll');
      },
    },
    destroy,
  };
}
