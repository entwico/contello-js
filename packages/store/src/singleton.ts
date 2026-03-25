import type { ContelloClient, OperationMap } from '@contello/client';
import { type MaybePromise, ProjectedValue, maybeThen } from 'projected';
import { type Observable, Subject } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import type { Singleton, SingletonDef, SingletonSync, SingletonSyncDef } from './types';
import { createRefresher } from './utils';
import type { UpdateBatch } from './watcher';

export type InternalSingleton<T> = Singleton<T>;

export type InternalSingletonSync<T> = SingletonSync<T>;

export function createSingleton<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped,
  TModels extends string = string,
>(
  def: SingletonDef<TOps, TModel, TRaw, TMapped, TModels>,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalSingleton<TMapped> {
  const _def = {
    name: def.name ?? def.model,
    model: def.model,
    cache: {
      ttl: def.cache?.ttl,
      eviction: def.cache?.eviction ?? 'refresh',
    },
  };

  const dependencyCollector = new DependencyCollector<string, TModels>(_def.model, resolver);
  const itemKey = `singleton:${_def.name}`;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const projected = new ProjectedValue<TMapped>({
    value: () =>
      wrap(`singleton:${_def.name}`, () =>
        maybeThen(def.fetch(client), (raw) =>
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
      await projected.get();

      loaded = true;

      if (_def.cache.ttl !== undefined) {
        timer = setTimeout(scheduleRefresh, _def.cache.ttl);
      }

      def.onLoad?.();
    },
  };
}

export function createSingletonSync<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped,
  TModels extends string = string,
>(
  def: SingletonSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalSingletonSync<TMapped> {
  const base = createSingleton(def, client, updates$, resolver);

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
