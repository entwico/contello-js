import {
  BUILT_IN_MUTATIONS,
  type ContelloClient,
  type DownloadResult,
  type ProxyResult,
  type SourceMutationKind,
  type SourceMutationValues,
  type UploadData,
  type UploadMetadata,
  type UploadOptions,
  createSourceMutation,
  createSourceMutationVariables,
  createSourceSubscription,
} from '@contello/client';
import type { MaybePromise, ReadonlyDeep } from '@entwico/dash';
import { type AsyncIterableSubject, concatAsync, mapAsync, retryWithBackoff } from '@entwico/dash/async';
import { ProjectedMap } from '@entwico/projected';

import { type StoreAssetFragment, type StoreFileFragment, schema as storeSchema } from './generated/graphql';
import type { StoreAsset, StoreFile } from './lazy-assets';
import { wrap } from './telemetry';
import type { CacheOptions, CollectionWrites, Created, RefreshEvent, RefreshKind, SyncCacheOptions } from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';
import { createWriteBuffer } from './write-buffer';

export type AssetsOptions = {
  cache?: CacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type AssetsSyncOptions = {
  cache?: SyncCacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

/**
 * There is no `create`: an asset comes into being through `upload()`, which is the transport, not
 * a mutation. `update` patches the mutable metadata — fields left out keep their value.
 */
export type Assets<TWrites = unknown> = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<StoreAsset> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreAsset>>>;
  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string>;
  download(fileId: string): Promise<DownloadResult>;
  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult>;
  refresh(): void;
} & CollectionWrites<StoreAsset, TWrites>;

export type AssetsSync<TWrites = unknown> = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<StoreAsset> | undefined;
  get(ids: readonly string[]): ReadonlyArray<ReadonlyDeep<StoreAsset>>;
  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string>;
  download(fileId: string): Promise<DownloadResult>;
  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult>;
  refresh(): void;
} & CollectionWrites<StoreAsset, TWrites>;

function mapFile(raw: StoreFileFragment): StoreFile {
  return {
    uid: raw.uid,
    mimeType: raw.mimeType,
    metadata: raw.metadata ? { width: raw.metadata.width, height: raw.metadata.height } : undefined,
  };
}

function mapAsset(raw: StoreAssetFragment): StoreAsset {
  return {
    id: raw.id,
    original: mapFile(raw.original),
    preview: raw.preview ? mapFile(raw.preview) : undefined,
    optimized: raw.optimized.map((file) => mapFile(file)),
  };
}

export function createAssetsCollection(
  options: AssetsOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  refreshByTtl: RefreshByTtlQueue,
): Created<Assets> {
  const opts = options ?? {};
  const cache = {
    ttl: resolveTtl(opts.cache?.ttl),
    eviction: opts.cache?.eviction ?? 'refresh',
  } as const;

  const channel = createRefreshChannel<RefreshEvent>(opts.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: cache.ttl, run: () => runFullRefresh('ttl') });
  let loaded = false;

  // the built-in asset source plus its fixed write bindings — `mutations` is constant for every
  // Contello schema, so the store carries it rather than depending on a regenerated bundle
  const assetSource = { ...storeSchema.sources.storeAsset, mutations: BUILT_IN_MUTATIONS.asset };
  const assetsSourceDoc = createSourceSubscription(assetSource);

  const writeBuffer = createWriteBuffer<StoreAssetFragment>();

  function fetchAssets(ids: string[] | undefined): Promise<StoreAssetFragment[]> {
    return concatAsync(
      mapAsync(
        client.subscribe<{ source: StoreAssetFragment[] }>(assetsSourceDoc, { ids }),
        (data) => data.source,
      ),
    );
  }

  async function fetchOrTakeWritten(ids: string[] | undefined): Promise<StoreAssetFragment[]> {
    // a full fetch is authoritative for every id, so nothing stays parked behind it
    if (ids === undefined) {
      writeBuffer.clear();

      return fetchAssets(undefined);
    }

    const { written, missing } = writeBuffer.take(ids);

    if (missing.length === 0) {
      return written;
    }

    const fetched = await fetchAssets(missing);

    return written.length === 0 ? fetched : [...written, ...fetched];
  }

  const projected = new ProjectedMap<string, StoreAsset>({
    key: (asset) => asset.id,
    values: (ids) =>
      wrap('assets', async () => {
        const rawItems = await fetchOrTakeWritten(ids);
        const items = rawItems.map((item) => mapAsset(item));

        if (ids === undefined && !loaded) {
          loaded = true;
          ttl.mark();
          opts.onLoad?.(items.map((a) => a.id));
        }

        return items;
      }),
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
    if (!loaded || batch.asset.length === 0) {
      return;
    }

    const deleted: string[] = [];
    const upserted = new Set<string>();

    for (const event of batch.asset) {
      if (event.mutation === 'delete') {
        deleted.push(event.id);
      } else {
        upserted.add(event.id);
      }
    }

    if (cache.eviction === 'clear') {
      writeBuffer.clear();
      projected.clear();

      return;
    }

    writeBuffer.release(deleted);

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    runPartialRefresh([...upserted], deleted);
  });

  async function runMutation(kind: SourceMutationKind, values: SourceMutationValues): Promise<unknown> {
    const binding = assetSource.mutations?.[kind];

    if (!binding) {
      throw new Error(`@contello/store: assets cannot ${kind} — the schema exposes no ${kind} mutation for assets`);
    }

    const response = await client.execute<{ result: unknown }>(
      createSourceMutation(assetSource, kind),
      createSourceMutationVariables(binding, values),
    );

    if (response?.result === undefined || response.result === null) {
      throw new Error(`@contello/store: ${kind} on assets returned nothing`);
    }

    return response.result;
  }

  const writes = {
    async update(input: unknown): Promise<ReadonlyDeep<StoreAsset>> {
      const raw = (await runMutation('update', { input })) as StoreAssetFragment;

      writeBuffer.park(raw.id, raw);

      let map;

      try {
        map = await projected.refresh([raw.id]);
      } finally {
        // a refresh that never ran leaves the asset parked, so release what it did not consume
        writeBuffer.release([raw.id]);
      }

      emit([raw.id], 'write');

      const asset = map.get(raw.id);

      if (!asset) {
        throw new Error(
          `@contello/store: wrote asset "${raw.id}" but it is not in the cache — ` +
          `a concurrent full refresh did not return it`,
        );
      }

      return asset;
    },

    async delete(id: string): Promise<void> {
      await runMutation('delete', { input: { id }, id });

      writeBuffer.release([id]);
      projected.delete([id]);
      emit([id], 'write');
    },
  };

  const instance: Assets = {
    ...writes,
    refresh$: channel.stream$,

    async load() {
      if (!loaded) {
        await projected.getAllAsMap();
      }
    },

    get(idOrIds: string | readonly string[]): any {
      return projected.get(idOrIds as string);
    },

    upload(data, meta, options) {
      return client.upload(data, meta, options);
    },

    download(fileId) {
      return client.download(fileId);
    },

    proxyHls(path, signal) {
      return client.proxyHls(path, signal);
    },

    refresh() {
      runFullRefresh('on-demand');
    },
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

export function createAssetsSyncCollection(
  options: AssetsSyncOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  refreshByTtl: RefreshByTtlQueue,
): Created<AssetsSync> {
  const { instance: base, destroy } = createAssetsCollection(options, client, updates$, refreshByTtl);

  function assertSync<T>(value: MaybePromise<T>, method: string): T {
    if (value instanceof Promise) {
      throw new TypeError(`assets.${method}() is not initialized yet — call assets.load() first`);
    }

    return value;
  }

  return {
    instance: {
      ...base,
      get(idOrIds: string | readonly string[]): any {
        return assertSync(base.get(idOrIds as string), 'get');
      },
    },
    destroy,
  };
}
