import { ProjectedLazyMap, maybeThen } from 'projected';
import { type Observable, Subject } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import { createLruCache } from './lru';
import type { LazyCollection, LazyCollectionDef } from './types';
import { resolveFetchable } from './utils';
import type { UpdateBatch } from './watcher';

export function createLazyCollection<
  TSdk,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TEntityTypes extends string = string,
>(
  def: LazyCollectionDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  sdk: TSdk,
  updates$: Observable<UpdateBatch>,
  entityTypes: ReadonlySet<string> | undefined,
): LazyCollection<TMapped> {
  const _def = {
    name: def.name ?? def.model,
    model: def.model,
    cache: {
      max: def.cache?.max ?? 1000,
      ttl: def.cache?.ttl,
    },
  };

  const dependencyCollector = new DependencyCollector<string, TEntityTypes>(_def.model, entityTypes);
  const cache = createLruCache<string, TMapped>({
    max: _def.cache.max,
    ttl: _def.cache.ttl,
    onEvict: (_value, key) => dependencyCollector.removeItem(key),
  });

  const projected = new ProjectedLazyMap<string, TMapped>({
    key: (item) => item.id,
    values: (keys) =>
      wrap(`lazy-collection:${_def.name}`, () =>
        maybeThen(resolveFetchable(def.fetch(keys, sdk)), (rawItems) =>
          Promise.all(
            rawItems.map((item) =>
              dependencyCollector.createContext((ref, register) =>
                maybeThen(def.map(item, ref), (mapped) => {
                  register(mapped.id);

                  return mapped;
                }),
              ),
            ),
          ),
        ),
      ),
    cache,
    protection: 'freeze',
  });

  const refresh$ = new Subject<string[]>();

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
      def.onRefresh?.(ids);
    }
  });

  return {
    name: _def.name,
    refresh$: refresh$.asObservable(),

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },
  };
}
