import {
  type ContelloClient,
  type SourceDef,
  type SourceMutationKind,
  type SourceMutationValues,
  createSourceMutation,
  createSourceMutationVariables,
  createSourceSubscription,
} from '@contello/client';
import { type MaybePromise, type ReadonlyDeep, maybeAll, maybeThen } from '@entwico/dash';
import { type AsyncIterableSubject, concatAsync, mapAsync, retryWithBackoff } from '@entwico/dash/async';
import { ProjectedMap } from '@entwico/projected';
import { DependencyCollector } from './dependency-collector';
import type { ModelResolver } from './model-resolver';
import { wrap } from './telemetry';
import type {
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  CollectionWrites,
  Created,
  ExtractSourceResult,
  ExtractSourceWrites,
  RefreshEvent,
  RefreshKind,
} from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';
import { createWriteBuffer } from './write-buffer';

function fetchCollection<S extends SourceDef<string, 'entity'>>(
  source: S,
  client: ContelloClient<any>,
  ids: string[] | undefined,
): Promise<ExtractSourceResult<S>[]> {
  return concatAsync(
    mapAsync(
      client.subscribe<{ source: ExtractSourceResult<S>[] }>(createSourceSubscription(source), { ids }),
      (r) => r.source,
    ),
  );
}

/**
 * Runs one write mutation of the source. A create/update selects the source's fragment, so the
 * answer is a raw entity in exactly the shape the source subscription yields — the cache takes it
 * from there. A delete only carries an id.
 */
async function runMutation<TRaw extends { id: string }>(
  source: SourceDef<string, 'entity'>,
  client: ContelloClient<any>,
  name: string,
  kind: SourceMutationKind,
  values: SourceMutationValues,
): Promise<TRaw> {
  const binding = source.mutations?.[kind];

  if (!binding) {
    throw new Error(
      `@contello/store: collection "${name}" cannot ${kind} — the schema exposes no ${kind} mutation ` +
      `for model "${source.__model}"`,
    );
  }

  const document = createSourceMutation(source, kind);
  const response = await client.execute<{ result: TRaw | undefined }>(
    document,
    createSourceMutationVariables(binding, values),
  );

  if (!response?.result) {
    throw new Error(`@contello/store: ${kind} on collection "${name}" returned no entity`);
  }

  return response.result;
}

export function createCollection<
  TSource extends SourceDef<TModels, 'entity'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<Collection<TMapped, ExtractSourceWrites<TSource>>> {
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
  const channel = createRefreshChannel<RefreshEvent>(opts.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: _def.cache.ttl, run: () => runFullRefresh('ttl') });
  let loaded = false;

  const writeBuffer = createWriteBuffer<ExtractSourceResult<TSource>>();

  function fetchOrTakeWritten(ids: string[] | undefined): MaybePromise<ExtractSourceResult<TSource>[]> {
    // a full fetch is authoritative for every id, so nothing stays parked behind it
    if (ids === undefined) {
      writeBuffer.clear();

      return fetchCollection(source, client, undefined);
    }

    const { written, missing } = writeBuffer.take(ids);

    if (missing.length === 0) {
      return written;
    }

    if (written.length === 0) {
      return fetchCollection(source, client, missing);
    }

    return maybeThen(fetchCollection(source, client, missing), (fetched) => [...written, ...fetched]);
  }

  const projected = new ProjectedMap<string, TMapped>({
    key: (item) => item.id,
    values: (ids) =>
      wrap(`collection:${_def.name}`, () =>
        maybeThen(fetchOrTakeWritten(ids), async (rawItems) => {
          // eslint-disable-next-line @eslint-react/naming-convention-context-name -- `createContext` here is DependencyCollector's method, not React's; this is a non-React module
          const items = await maybeAll(
            rawItems.map((item) =>
              dependencyCollector.createContext((ref, register) =>
                maybeThen(mapFn(item, ref), (mapped) => {
                  register(mapped.id);

                  return mapped;
                }),
              ),
            ),
          );

          if (ids === undefined) {
            dependencyCollector.retainOnly(new Set(items.map((item) => item.id)));

            // start tracking refresh by ttl on first successful full fetch
            if (!loaded) {
              loaded = true;
              ttl.mark();
              opts.onLoad?.(items.map((item) => item.id));
            }
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
    sort: opts.sort,
  });

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  function runFullRefresh(kind: RefreshKind): void {
    refreshByTtl.enqueue(() =>
      retryWithBackoff(async () => {
        const map = await projected.refresh();

        emit(map.keys().toArray(), kind);
        ttl.mark();
      }),
    );
  }

  function runPartialRefresh(refreshIds: string[], deletedIds: string[]): void {
    const changedIds = [...new Set([...refreshIds, ...deletedIds])];

    if (refreshIds.length === 0) {
      emit(changedIds, 'upstream-update');

      return;
    }

    // upstream is authoritative for these until the refetch lands — no local write may answer it
    const settled = writeBuffer.awaitingUpstream(refreshIds);

    void retryWithBackoff(async () => {
      await projected.refresh(refreshIds);
      emit(changedIds, 'upstream-update');
    }).finally(settled);
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
      writeBuffer.clear();
      projected.clear();

      return;
    }

    writeBuffer.release(deleted);

    for (const id of deleted) {
      dependencyCollector.removeItem(id);
    }

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    const refreshIds = upserted.union(depAffected);

    for (const id of deleted) {
      refreshIds.delete(id);
    }

    runPartialRefresh([...refreshIds], deleted);
  });

  /** Puts a written entity into the cache through the normal refresh path and returns it mapped. */
  async function takeIntoCache(entity: ExtractSourceResult<TSource> & { id: string }): Promise<ReadonlyDeep<TMapped>> {
    writeBuffer.park(entity.id, entity);

    let map;

    try {
      map = await projected.refresh([entity.id]);
    } finally {
      // a refresh that never ran leaves the entity parked, so release what it did not consume
      writeBuffer.release([entity.id]);
    }

    emit([entity.id], 'write');

    const item = map.get(entity.id);

    if (!item) {
      throw new Error(
        `@contello/store: collection "${_def.name}" wrote entity "${entity.id}" but it is not in the cache — ` +
        `a concurrent full refresh did not return it`,
      );
    }

    return item;
  }

  /**
   * One method per mutation the source binds — a model the schema exposes no `createX` for has
   * no `create`, matching what `CollectionWrites` types. Permission is not decided here: the
   * server rejects a write the token may not run.
   */
  function createWrites(): CollectionWrites<TMapped, ExtractSourceWrites<TSource>> {
    const out: Record<string, unknown> = {};

    if (source.mutations?.create) {
      out['create'] = async (input: unknown) =>
        takeIntoCache(await runMutation(source, client, _def.name, 'create', { input }));
    }

    if (source.mutations?.update) {
      out['update'] = async (input: unknown) =>
        takeIntoCache(await runMutation(source, client, _def.name, 'update', { input }));
    }

    if (source.mutations?.delete) {
      out['delete'] = async (id: string, options?: Record<string, unknown> | undefined) => {
        await runMutation(source, client, _def.name, 'delete', { input: { ...options, id }, id });

        writeBuffer.release([id]);
        dependencyCollector.removeItem(id);
        projected.delete([id]);
        emit([id], 'write');
      };
    }

    return out as CollectionWrites<TMapped, ExtractSourceWrites<TSource>>;
  }

  const instance: Collection<TMapped, ExtractSourceWrites<TSource>> = {
    name: _def.name,
    refresh$: channel.stream$,

    get(idOrIds: string | readonly string[]): any {
      return projected.get(idOrIds as string);
    },

    getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<TMapped>>> {
      return projected.getAll();
    },

    refresh() {
      runFullRefresh('on-demand');
    },

    async load() {
      if (!loaded) {
        await projected.getAllAsMap();
      }
    },

    ...createWrites(),
  };

  return {
    instance,
    destroy() {
      unsubUpdates();
      ttl.clear();
      channel.complete();
    },
  };
}

export function createCollectionSync<
  TSource extends SourceDef<TModels, 'entity'>,
  TMapped extends { id: string },
  TModels extends string = string,
>(
  source: TSource,
  options: CollectionSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels> | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  resolver: ModelResolver,
  refreshByTtl: RefreshByTtlQueue,
): Created<CollectionSync<TMapped, ExtractSourceWrites<TSource>>> {
  const { instance: base, destroy } = createCollection<TSource, TMapped, TModels>(
    source,
    options,
    client,
    updates$,
    resolver,
    refreshByTtl,
  );

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new TypeError(`collection "${base.name}".${method}() is not initialized yet — call collection.load() first`);
    }

    return value;
  }

  return {
    // the write half passes through untouched — a mutation is a round trip either way
    instance: {
      ...base,
      get(idOrIds: string | readonly string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
      getAll(): ReadonlyArray<ReadonlyDeep<TMapped>> {
        return assertSync(base.getAll(), 'getAll');
      },
    } as unknown as CollectionSync<TMapped, ExtractSourceWrites<TSource>>,
    destroy,
  };
}
