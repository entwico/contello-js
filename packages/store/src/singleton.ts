import {
  type AsyncIterableSubject,
  type ContelloClient,
  type SourceDef,
  createAsyncIterableSubject,
  createSourceSubscription,
  firstAsync,
  mapAsync,
} from '@contello/client';
import { type MaybePromise, ProjectedValue, type ReadonlyDeep, maybeThen } from 'projected';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import type {
  Created,
  ExtractSourceResult,
  Singleton,
  SingletonOptions,
  SingletonSync,
  SingletonSyncOptions,
} from './types';
import { createRefresher } from './utils';
import type { UpdateBatch } from './watcher';

export function createSingleton<
  TSource extends SourceDef<TModels, 'singleton'>,
  TMapped,
  TModels extends string = string,
>(
  source: TSource,
  options: SingletonOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<Singleton<TMapped>> {
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
  const itemKey = `singleton:${_def.name}`;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const projected = new ProjectedValue<TMapped>({
    value: () =>
      wrap(`singleton:${_def.name}`, () =>
        maybeThen(
          firstAsync(
            mapAsync(
              client.subscribe<{ source: ExtractSourceResult<TSource> }>(createSourceSubscription(source)),
              (r) => r.source,
            ),
          ),
          (raw) =>
            dependencyCollector.createContext((ref, register) =>
              maybeThen(mapFn(raw, ref), (mapped) => {
                register(itemKey);

                return mapped;
              }),
            ),
        ),
      ),
  });

  const refresh$ = createAsyncIterableSubject<void>();

  const scheduleRefresh = createRefresher(
    () => projected.refresh(),
    () => {
      refresh$.next();
      opts.onRefresh?.();

      if (_def.cache.ttl !== undefined) {
        timer = setTimeout(scheduleRefresh, _def.cache.ttl);
      }
    },
    () => clearTimeout(timer),
  );

  let loaded = false;

  const unsubUpdates = updates$.subscribe((batch) => {
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
    instance: {
      name: _def.name,
      refresh$,

      get(): MaybePromise<ReadonlyDeep<TMapped>> {
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

        opts.onLoad?.();
      },
    },
    destroy() {
      unsubUpdates();
      clearTimeout(timer);
      refresh$.complete();
    },
  };
}

export function createSingletonSync<
  TSource extends SourceDef<TModels, 'singleton'>,
  TMapped,
  TModels extends string = string,
>(
  source: TSource,
  options: SingletonSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
): Created<SingletonSync<TMapped>> {
  const { instance: base, destroy } = createSingleton<TSource, TMapped, TModels>(
    source,
    options,
    client,
    updates$,
    resolver,
  );

  return {
    instance: {
      ...base,

      get(): ReadonlyDeep<TMapped> {
        const result = base.get();

        if (result instanceof Promise) {
          throw new Error(`singleton "${base.name}" is not initialized yet — call singleton.load() first`);
        }

        return result;
      },
    },
    destroy,
  };
}
