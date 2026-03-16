import { type MaybePromise, ProjectedValue, maybeThen } from 'projected';
import { type Observable, Subject } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { Singleton, SingletonDef, SingletonSync, SingletonSyncDef } from './types';
import { createRefresher } from './utils';
import type { UpdateBatch } from './watcher';

export type InternalSingleton<T> = Singleton<T>;

export type InternalSingletonSync<T> = SingletonSync<T>;

export function createSingleton<TSdk, TModel extends string, TRaw, TMapped, TEntityTypes extends string = string>(
  def: SingletonDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  sdk: TSdk,
  updates$: Observable<UpdateBatch>,
  entityTypes: ReadonlySet<string> | undefined,
): InternalSingleton<TMapped> {
  const _def = {
    name: def.name ?? def.model,
    model: def.model,
    cache: {
      ttl: def.cache?.ttl,
      eviction: def.cache?.eviction ?? 'refresh',
    },
  };

  const dependencyCollector = new DependencyCollector<string, TEntityTypes>(_def.model, entityTypes);
  const itemKey = `singleton:${_def.name}`;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const projected = new ProjectedValue<TMapped>({
    value: () =>
      wrap(`singleton:${_def.name}`, () =>
        maybeThen(def.fetch(sdk), (raw) =>
          dependencyCollector.createContext((ref, register) =>
            maybeThen(def.map(raw, ref), (mapped) => {
              register(itemKey);

              return mapped;
            }),
          ),
        ),
      ),
    protection: 'freeze',
  });

  const refresh$ = new Subject<void>();

  const scheduleRefresh = createRefresher(
    () => projected.refresh(),
    () => {
      refresh$.next();
      def.onRefresh?.();

      if (_def.cache.ttl !== undefined) {
        timer = setTimeout(scheduleRefresh, _def.cache.ttl);
      }
    },
    () => clearTimeout(timer),
  );

  updates$.subscribe((batch) => {
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

  return {
    name: _def.name,
    refresh$: refresh$.asObservable(),

    get(): MaybePromise<TMapped> {
      return projected.get();
    },

    refresh() {
      scheduleRefresh();
    },

    async load() {
      scheduleRefresh(); // schedule ensures that timer is set properly
      await projected.get();
      def.onLoad?.();
    },
  };
}

export function createSingletonSync<TSdk, TModel extends string, TRaw, TMapped, TEntityTypes extends string = string>(
  def: SingletonSyncDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  sdk: TSdk,
  updates$: Observable<UpdateBatch>,
  entityTypes: ReadonlySet<string> | undefined,
): InternalSingletonSync<TMapped> {
  const base = createSingleton(def, sdk, updates$, entityTypes);

  return {
    ...base,

    get(): TMapped {
      const result = base.get();

      if (result instanceof Promise) {
        throw new Error(`singleton "${def.name}" is not initialized yet — call singleton.load() first`);
      }

      return result;
    },
  };
}
