import type { ContelloClient, OperationMap } from '@contello/client';
import { type MaybePromise, ProjectedMap, maybeThen } from 'projected';
import { type Observable, Subject } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import type { Collection, CollectionDef, CollectionSync, CollectionSyncDef } from './types';
import { createRefresher, resolveFetchable } from './utils';
import type { UpdateBatch } from './watcher';

export type InternalCollection<T> = Collection<T>;

export type InternalCollectionSync<T> = CollectionSync<T>;

export function createCollection<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  def: CollectionDef<TOps, TModel, TRaw, TMapped, TModels>,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalCollection<TMapped> {
  const _def = {
    name: def.name ?? def.model,
    model: def.model,
    cache: {
      ttl: def.cache?.ttl,
      eviction: def.cache?.eviction ?? 'refresh',
    },
  };
  const dependencyCollector = new DependencyCollector<string, TModels>(_def.model, resolver);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const projected = new ProjectedMap<string, TMapped>({
    key: (item) => item.id,
    values: () =>
      wrap(`collection:${_def.name}`, () =>
        maybeThen(resolveFetchable(def.fetch(client)), (rawItems) =>
          // maybeAll one day?
          Promise.all(
            rawItems.map((item) =>
              dependencyCollector.createContext((ref, register) =>
                maybeThen(def.map(item, ref), (mapped) => {
                  register(mapped.id);

                  return mapped;
                }),
              ),
            ),
          ).then((items) => {
            dependencyCollector.retainOnly(new Set(items.map((item) => item.id)));

            return items;
          }),
        ),
      ),
    protection: 'freeze',
  });

  const refresh$ = new Subject<string[]>();

  const scheduleRefresh = createRefresher(
    () => projected.refresh(),
    () => {
      maybeThen(projected.getAll(), (items) => {
        const ids = items.map((item) => item.id);

        refresh$.next(ids);
        def.onRefresh?.(ids);

        if (_def.cache.ttl !== undefined) {
          timer = setTimeout(scheduleRefresh, _def.cache.ttl);
        }
      });
    },
    () => clearTimeout(timer),
  );

  let loaded = false;

  updates$.subscribe((batch) => {
    if (!loaded) {
      return;
    }

    const hasOwnModel = batch.entity.has(_def.model);
    const hasAffectedRefs = batch.events.some((event) => dependencyCollector.getAffectedKeys(event).size > 0);

    if (!hasOwnModel && !hasAffectedRefs) {
      return;
    }

    if (_def.cache.eviction === 'clear') {
      dependencyCollector.clear();
      projected.clear();

      return;
    }

    scheduleRefresh();
  });

  const instance: InternalCollection<TMapped> = {
    name: _def.name,
    refresh$: refresh$.asObservable(),

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },

    getAll(): MaybePromise<TMapped[]> {
      return projected.getAll();
    },

    refresh() {
      scheduleRefresh();
    },

    async load() {
      const items = await projected.getAll();

      loaded = true;

      if (_def.cache.ttl !== undefined) {
        timer = setTimeout(scheduleRefresh, _def.cache.ttl);
      }

      def.onLoad?.(items.map((item) => item.id));
    },
  };

  return instance;
}

export function createCollectionSync<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  def: CollectionSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalCollectionSync<TMapped> {
  const base = createCollection(def, client, updates$, resolver);

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new Error(`collection "${def.name}".${method}() is not initialized yet — call collection.load() first`);
    }

    return value;
  }

  return {
    ...base,
    get(idOrIds: string | string[]): any {
      return assertSync(base.get(idOrIds as string), 'get');
    },
    getAll(): TMapped[] {
      return assertSync(base.getAll(), 'getAll');
    },
  };
}
