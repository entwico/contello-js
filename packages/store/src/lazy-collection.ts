import type { ContelloClient, OperationMap, SourceDef } from '@contello/client';
import { ProjectedLazyMap, maybeThen } from 'projected';
import { type Observable, Subject, firstValueFrom, map as rxMap } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import { createLruCache } from './lru';
import type { ModelResolver } from './model-resolver';
import { createSourceSubscription } from './source-subscription';
import type { ExtractSourceResult, LazyCollection, LazyCollectionOptions } from './types';
import { createRefresher } from './utils';
import type { UpdateBatch } from './watcher';

export function createLazyCollection<
  TOps extends OperationMap | undefined,
  TSource extends SourceDef<TModels, 'collection'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: LazyCollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): LazyCollection<TMapped> {
  const opts = options ?? {};
  const mapFn = opts.map ?? ((item: ExtractSourceResult<TSource>) => item as unknown as TMapped);
  const _def = {
    name: opts.name ?? source.__model,
    model: source.__model,
    cache: {
      max: opts.cache?.max ?? 1000,
      ttl: opts.cache?.ttl,
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
          firstValueFrom(
            client
              .subscribe<{ source: ExtractSourceResult<TSource>[] }>(createSourceSubscription(source), { ids: keys })
              .pipe(rxMap((r) => r.source)),
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

  const refresh$ = new Subject<string[]>();

  let lastRefreshKeys: string[] = [];

  const scheduleRefresh = createRefresher(
    async () => {
      lastRefreshKeys = cache.keys();

      if (lastRefreshKeys.length === 0) {
        return;
      }

      await projected.refresh(lastRefreshKeys);
    },
    () => {
      if (lastRefreshKeys.length > 0) {
        refresh$.next(lastRefreshKeys);
        opts.onRefresh?.(lastRefreshKeys);
      }
    },
    () => {},
  );

  updates$.subscribe((batch) => {
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

      const ids = [...evicted];

      refresh$.next(ids);
      opts.onRefresh?.(ids);
    }
  });

  return {
    name: _def.name,
    refresh$: refresh$.asObservable(),

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },

    refresh() {
      scheduleRefresh();
    },

    clear() {
      dependencyCollector.clear();
      projected.clear();
    },
  };
}
