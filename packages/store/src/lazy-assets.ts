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
} from '@contello/client';
import { ProjectedLazyMap, type ReadonlyDeep } from 'projected';
import { wrap } from './diagnostics';
import { type StoreAssetFragment, type StoreFileFragment, schema as storeSchema } from './generated/graphql';
import { createLruCache } from './lru';
import type { Created, LazyCacheOptions, RefreshEvent, RefreshKind } from './types';
import { createRefreshChannel, createRefresher, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export type StoreFileMetadata = {
  width: number;
  height: number;
};

export type StoreFile = {
  uid: string;
  mimeType: string;
  metadata: StoreFileMetadata | undefined;
};

export type StoreAsset = {
  id: string;
  original: StoreFile;
  preview: StoreFile | undefined;
  optimized: StoreFile[];
};

export type LazyAssetsOptions = {
  cache?: LazyCacheOptions | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type LazyAssets = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  get(id: string): Promise<ReadonlyDeep<StoreAsset> | undefined>;
  get(ids: string[]): Promise<ReadonlyDeep<StoreAsset[]>>;
  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string>;
  download(fileId: string): Promise<DownloadResult>;
  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult>;
  refresh(): void;
  clear(): void;
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
    optimized: raw.optimized.map(mapFile),
  };
}

export function createLazyAssetsCollection(
  def: LazyAssetsOptions | undefined,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
): Created<LazyAssets> {
  const _def = {
    cache: {
      max: def?.cache?.max ?? 1000,
      ttl: resolveTtl(def?.cache?.ttl),
    },
  };

  const cache = createLruCache<string, StoreAsset>({ max: _def.cache.max, ttl: _def.cache.ttl, onEvict: undefined });

  const assetsSourceDoc = createSourceSubscription(storeSchema.sources.storeAsset);

  const projected = new ProjectedLazyMap<string, StoreAsset>({
    key: (asset) => asset.id,
    values: (ids) =>
      wrap('assets', () =>
        collectAsync(
          mapAsync(client.subscribe<{ source: StoreAssetFragment[] }>(assetsSourceDoc, { ids }), (data) => data.source),
        ).then((rawItems) => rawItems.map(mapAsset)),
      ),
    cache,
  });

  const channel = createRefreshChannel<RefreshEvent>(def?.onRefresh);

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  let lastRefreshKeys: string[] = [];

  const scheduleRefresh = createRefresher<RefreshKind>(
    async () => {
      lastRefreshKeys = cache.keys();

      if (lastRefreshKeys.length === 0) {
        return;
      }

      await projected.refresh(lastRefreshKeys);
    },
    (kind) => {
      if (lastRefreshKeys.length > 0) {
        emit(lastRefreshKeys, kind);
      }
    },
    () => {},
  );

  const unsubUpdates = updates$.subscribe((batch) => {
    if (batch.asset.length === 0) return;

    for (const event of batch.asset) {
      projected.delete(event.id);
    }

    emit(
      batch.asset.map((e) => e.id),
      'upstream-update',
    );
  });

  return {
    instance: {
      refresh$: channel.stream$,

      get(idOrIds: string | string[]): any {
        return projected.get(idOrIds as string);
      },

      upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string> {
        return client.upload(data, meta, options);
      },

      download(fileId: string): Promise<DownloadResult> {
        return client.download(fileId);
      },

      proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult> {
        return client.proxyHls(path, signal);
      },

      refresh() {
        scheduleRefresh('on-demand');
      },

      clear() {
        projected.clear();
      },
    },
    destroy() {
      unsubUpdates();
      channel.complete();
    },
  };
}
