import {
  type AsyncIterableSubject,
  type ContelloClient,
  type SourceDef,
  createSourceSubscription,
  firstAsync,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedValue, type ReadonlyDeep, maybeThen } from 'projected';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import type {
  Created,
  ExtractSourceResult,
  RefreshKind,
  Singleton,
  SingletonOptions,
  SingletonRefreshEvent,
  SingletonSync,
  SingletonSyncOptions,
} from './types';
import {
  type RefreshByTtlQueue,
  createRefreshChannel,
  createRefresher,
  createTtlOrchestrator,
  resolveTtl,
} from './utils';
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
  refreshByTtl: RefreshByTtlQueue,
): Created<Singleton<TMapped>> {
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
  const itemKey = `singleton:${_def.name}`;
  const channel = createRefreshChannel<SingletonRefreshEvent>(opts.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: _def.cache.ttl, run: () => runTtlRefresh() });
  let loaded = false;

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

                // start tracking refresh by ttl on first successful full fetch
                if (!loaded) {
                  loaded = true;
                  ttl.mark();
                  opts.onLoad?.();
                }

                return mapped;
              }),
            ),
        ),
      ),
  });

  function emit(kind: RefreshKind): void {
    channel.emit({ kind });
  }

  function runTtlRefresh(): void {
    refreshByTtl.enqueue(() =>
      runWithBackoff(() => projected.refresh()).then(() => {
        emit('ttl');
        ttl.mark();
      }),
    );
  }

  const scheduleRefresh = createRefresher<RefreshKind>(
    () => projected.refresh(),
    (kind) => {
      emit(kind);
      ttl.mark();
    },
    () => {},
  );

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

    scheduleRefresh('upstream-update');
  });

  return {
    instance: {
      name: _def.name,
      refresh$: channel.stream$,

      get(): MaybePromise<ReadonlyDeep<TMapped>> {
        return projected.get();
      },

      refresh() {
        scheduleRefresh('on-demand');
      },

      async load() {
        if (!loaded) {
          await projected.get();
        }
      },
    },
    destroy() {
      unsubUpdates();
      ttl.clear();
      channel.complete();
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
  refreshByTtl: RefreshByTtlQueue,
): Created<SingletonSync<TMapped>> {
  const { instance: base, destroy } = createSingleton<TSource, TMapped, TModels>(
    source,
    options,
    client,
    updates$,
    resolver,
    refreshByTtl,
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
