import type { ContelloClient, OperationMap, SourceDef } from '@contello/client';
import { type MaybePromise, ProjectedValue, type ReadonlyDeep, maybeThen } from 'projected';
import { type Observable, Subject, firstValueFrom, map as rxMap } from 'rxjs';
import { DependencyCollector } from './dependency-collector';
import { wrap } from './diagnostics';
import type { ModelResolver } from './model-resolver';
import { createSourceSubscription } from './source-subscription';
import type { ExtractSourceResult, Singleton, SingletonOptions, SingletonSync, SingletonSyncOptions } from './types';
import { createRefresher } from './utils';
import type { UpdateBatch } from './watcher';

export type InternalSingleton<T> = Singleton<T>;

export type InternalSingletonSync<T> = SingletonSync<T>;

export function createSingleton<
  TOps extends OperationMap | undefined,
  TSource extends SourceDef<TModels, 'singleton'>,
  TMapped,
  TModels extends string = string,
>(
  source: TSource,
  options: SingletonOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalSingleton<TMapped> {
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
          firstValueFrom(
            client
              .subscribe<{ source: ExtractSourceResult<TSource> }>(createSourceSubscription(source))
              .pipe(rxMap((r) => r.source)),
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

  const refresh$ = new Subject<void>();

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
  };
}

export function createSingletonSync<
  TOps extends OperationMap | undefined,
  TSource extends SourceDef<TModels, 'singleton'>,
  TMapped,
  TModels extends string = string,
>(
  source: TSource,
  options: SingletonSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<TOps>,
  updates$: Observable<UpdateBatch>,
  resolver: ModelResolver,
): InternalSingletonSync<TMapped> {
  const base = createSingleton<TOps, TSource, TMapped, TModels>(source, options, client, updates$, resolver);

  return {
    ...base,

    get(): ReadonlyDeep<TMapped> {
      const result = base.get();

      if (result instanceof Promise) {
        throw new Error(`singleton "${base.name}" is not initialized yet — call singleton.load() first`);
      }

      return result;
    },
  };
}
