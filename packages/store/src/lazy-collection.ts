import {
  type AsyncIterableSubject,
  type ContelloClient,
  type SourceDef,
  collectAsync,
  createAsyncIterableSubject,
  createSourceSubscription,
  mapAsync,
} from '@contello/client';
import { ProjectedLazyMap, maybeThen } from 'projected';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import { createLruCache } from './lru';
import type { ModelResolver } from './model-resolver';
import type {
  Created,
  ExtractSourceResult,
  LazyCollection,
  LazyCollectionOptions,
  RefreshEvent,
  RefreshKind,
} from './types';
import { DEFAULT_LRU_MAX, createRefresher, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export function createLazyCollection<
  TSource extends SourceDef<TModels, 'entity'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: LazyCollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<LazyCollection<TMapped>> {
  const opts = options ?? {};
  const mapFn = opts.map ?? ((item: ExtractSourceResult<TSource>) => item as unknown as TMapped);
  const _def = {
    name: opts.name ?? source.__model,
    model: source.__model,
    cache: {
      max: opts.cache?.max ?? DEFAULT_LRU_MAX,
      ttl: resolveTtl(opts.cache?.ttl),
    },
  };

  const dependencyCollector = new DependencyCollector<string, TModels>(_def.model, resolver);
  const cache = createLruCache<string, TMapped>({
    max: _def.cache.max,
    ttl: _def.cache.ttl,
    onEvict: (_value, key) => dependencyCollector.removeItem(key),
  });

  const projected = new ProjectedLazyMap<string, TMapped>({
    key: (item) => item.id,
    values: (keys) =>
      wrap(`lazy-collection:${_def.name}`, () =>
        maybeThen(
          collectAsync(
            mapAsync(
              client.subscribe<{ source: ExtractSourceResult<TSource>[] }>(createSourceSubscription(source), {
                ids: keys,
              }),
              (r) => r.source,
            ),
          ),
          (rawItems) =>
            Promise.all(
              rawItems.map((item) =>
                dependencyCollector.createContext((ref, register) =>
                  maybeThen(mapFn(item, ref), (mapped) => {
                    register(mapped.id);

                    return mapped;
                  }),
                ),
              ),
            ),
        ),
      ),
    cache,
  });

  const refresh$ = createAsyncIterableSubject<RefreshEvent>();

  function emit(ids: string[], kind: RefreshKind): void {
    const event: RefreshEvent = { ids, kind };

    refresh$.next(event);
    opts.onRefresh?.(event);
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
        emit(lastRefreshKeys, kind);
      }
    },
    () => {},
  );

  const unsubUpdates = updates$.subscribe((batch) => {
    const evicted = new Set<string>();
    const ownModelEvents = batch.entity.get(_def.model);

    if (ownModelEvents) {
      for (const event of ownModelEvents) {
        evicted.add(event.id);
      }
    }

    for (const event of batch.events) {
      for (const key of dependencyCollector.getAffectedKeys(event)) {
        evicted.add(key);
      }
    }

    if (evicted.size > 0) {
      for (const key of evicted) {
        dependencyCollector.removeItem(key);
        projected.delete(key);
      }

      emit([...evicted], 'upstream-update');
    }
  });

  return {
    instance: {
      name: _def.name,
      refresh$,

      get(idOrIds: string | string[]): any {
        return projected.get(idOrIds as string);
      },

      refresh() {
        scheduleRefresh('on-demand');
      },

      clear() {
        dependencyCollector.clear();
        projected.clear();
      },
    },
    destroy() {
      unsubUpdates();
      refresh$.complete();
    },
  };
}
