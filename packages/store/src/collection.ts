import {
  type AsyncIterableSubject,
  type ContelloClient,
  type OperationMap,
  type SourceDef,
  createAsyncIterableSubject,
  firstAsync,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep, maybeThen } from 'projected';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import { createSourceSubscription } from './source-subscription';
import type {
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  Created,
  ExtractSourceResult,
} from './types';
import type { UpdateBatch } from './watcher';

function fetchCollection<S extends SourceDef<string, 'collection'>>(
  source: S,
  client: ContelloClient<any>,
  ids: string[] | undefined,
): Promise<ExtractSourceResult<S>[]> {
  return firstAsync(
    mapAsync(
      client.subscribe<{ source: ExtractSourceResult<S>[] }>(createSourceSubscription(source), { ids }),
      (r) => r.source,
    ),
  );
}

export function createCollection<
  TOps extends OperationMap | undefined,
  TSource extends SourceDef<TModels, 'collection'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<TOps>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<Collection<TMapped>> {
  const opts = options ?? {};
  const mapFn = opts.map ?? ((item: ExtractSourceResult<TSource>) => item as unknown as TMapped);
  const _def = {
    name: opts.name ?? source.__model,
    model: source.__model,
    cache: {
      ttl: opts.cache?.ttl,
      eviction: opts.cache?.eviction ?? 'refresh',
    },
  };
  const dependencyCollector = new DependencyCollector<string, TModels>(_def.model, resolver);
  let ttlTimer: ReturnType<typeof setTimeout> | undefined;

  const projected = new ProjectedMap<string, TMapped>({
    key: (item) => item.id,
    values: (ids) =>
      wrap(`collection:${_def.name}`, () =>
        maybeThen(fetchCollection(source, client, ids), (rawItems) =>
          Promise.all(
            rawItems.map((item) =>
              dependencyCollector.createContext((ref, register) =>
                maybeThen(mapFn(item, ref), (mapped) => {
                  register(mapped.id);

                  return mapped;
                }),
              ),
            ),
          ).then((items) => {
            if (ids === undefined) {
              dependencyCollector.retainOnly(new Set(items.map((item) => item.id)));
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
      ),
    sort: opts.sort,
  });

  const refresh$ = createAsyncIterableSubject<string[]>();
  let loaded = false;

  function scheduleTtl(): void {
    if (_def.cache.ttl === undefined) {
      return;
    }

    clearTimeout(ttlTimer);

    ttlTimer = setTimeout(() => {
      runFullRefresh();
    }, _def.cache.ttl);
  }

  function runFullRefresh(): void {
    void runWithBackoff(() =>
      projected.refresh().then((map) => {
        const ids = [...map.keys()];

        refresh$.next(ids);
        opts.onRefresh?.(ids);

        scheduleTtl();
      }),
    );
  }

  function runPartialRefresh(refreshIds: string[], deletedIds: string[]): void {
    const changedIds = [...new Set([...refreshIds, ...deletedIds])];

    if (refreshIds.length === 0) {
      refresh$.next(changedIds);
      opts.onRefresh?.(changedIds);

      return;
    }

    void runWithBackoff(() =>
      projected.refresh(refreshIds).then(() => {
        refresh$.next(changedIds);
        opts.onRefresh?.(changedIds);
      }),
    );
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

    const refreshIds = new Set([...upserted, ...depAffected]);

    for (const id of deleted) {
      refreshIds.delete(id);
    }

    runPartialRefresh([...refreshIds], deleted);
  });

  const instance: Collection<TMapped> = {
    name: _def.name,
    refresh$,

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },

    getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<TMapped>>> {
      return projected.getAll();
    },

    refresh() {
      runFullRefresh();
    },

    async load() {
      const map = await projected.refresh();

      loaded = true;

      scheduleTtl();

      opts.onLoad?.([...map.keys()]);
    },
  };

  return {
    instance,
    destroy() {
      unsubUpdates();
      clearTimeout(ttlTimer);
      refresh$.complete();
    },
  };
}

export function createCollectionSync<
  TOps extends OperationMap | undefined,
  TSource extends SourceDef<TModels, 'collection'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<TOps>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<CollectionSync<TMapped>> {
  const { instance: base, destroy } = createCollection<TOps, TSource, TMapped, TModels>(
    source,
    options,
    client,
    updates$,
    resolver,
  );

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new Error(`collection "${base.name}".${method}() is not initialized yet — call collection.load() first`);
    }

    return value;
  }

  return {
    instance: {
      ...base,
      get(idOrIds: string | string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
      getAll(): ReadonlyArray<ReadonlyDeep<TMapped>> {
        return assertSync(base.getAll(), 'getAll');
      },
    },
    destroy,
  };
}
