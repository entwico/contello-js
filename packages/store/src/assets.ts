import {
  type AsyncIterableSubject,
  type ContelloClient,
  type DownloadResult,
  type ProxyResult,
  type UploadData,
  type UploadMetadata,
  type UploadOptions,
  collectAsync,
  createSourceSubscription,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep } from 'projected';

import { type StoreAssetFragment, type StoreFileFragment, schema as storeSchema } from './generated/graphql';
import type { StoreAsset, StoreFile } from './lazy-assets';
import { wrap } from './telemetry';
import type { CacheOptions, Created, RefreshEvent, RefreshKind, SyncCacheOptions } from './types';
import { type RefreshByTtlQueue, createRefreshChannel, createTtlOrchestrator, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

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

export type Assets = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<StoreAsset> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<StoreAsset>>>;
  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string>;
  download(fileId: string): Promise<DownloadResult>;
  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult>;
  refresh(): void;
};

export type AssetsSync = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<StoreAsset> | undefined;
  get(ids: readonly string[]): ReadonlyArray<ReadonlyDeep<StoreAsset>>;
  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string>;
  download(fileId: string): Promise<DownloadResult>;
  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult>;
  refresh(): void;
};

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

  const assetsSourceDoc = createSourceSubscription(storeSchema.sources.storeAsset);

  const projected = new ProjectedMap<string, StoreAsset>({
    key: (asset) => asset.id,
    values: (ids) =>
      wrap('assets', async () => {
        const rawItems = await collectAsync(
          mapAsync(client.subscribe<{ source: StoreAssetFragment[] }>(assetsSourceDoc, { ids }), (data) => data.source),
        );
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
      runWithBackoff(async () => {
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

    void runWithBackoff(async () => {
      await projected.refresh(refreshIds);
      emit(changedIds, 'upstream-update');
    });
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
      projected.clear();

      return;
    }

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    runPartialRefresh([...upserted], deleted);
  });

  const instance: Assets = {
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
