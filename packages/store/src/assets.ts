import type { ContelloSdkClient } from '@contello/sdk-client';
import { ProjectedLazyMap } from 'projected';
import { type Observable, Subject } from 'rxjs';
import ASSETS_QUERY from '../graphql/assets.gql';
import { wrap } from './diagnostics';
import type { StoreAssetFragment, StoreFileFragment, StoreGetAssetsQuery } from './generated/graphql';
import { createLruCache } from './lru';
import type { LazyCacheOptions } from './types';
import type { UpdateBatch } from './watcher';

export type StoreFileMetadata = {
  width: number;
  height: number;
};

export type StoreFile = {
  uid: string;
  mimeType: string;
  metadata: StoreFileMetadata | null;
};

export type StoreAsset = {
  id: string;
  original: StoreFile;
  preview: StoreFile | null;
  optimized: StoreFile[];
};

export type AssetCollectionOptions = {
  cache?: LazyCacheOptions | undefined;
};

export type Assets = {
  readonly refresh$: Observable<string[]>;
  get(id: string): Promise<StoreAsset | undefined>;
  get(ids: string[]): Promise<StoreAsset[]>;
  download(fileId: string): Promise<Response>;
};

function mapFile(raw: StoreFileFragment): StoreFile {
  return {
    uid: raw.uid,
    mimeType: raw.mimeType,
    metadata: raw.metadata ? { width: raw.metadata.width, height: raw.metadata.height } : null,
  };
}

function mapAsset(raw: StoreAssetFragment): StoreAsset {
  return {
    id: raw.id,
    original: mapFile(raw.original),
    preview: raw.preview ? mapFile(raw.preview) : null,
    optimized: raw.optimized.map(mapFile),
  };
}

export function createAssetsCollection(
  def: AssetCollectionOptions | undefined,
  client: ContelloSdkClient<unknown>,
  baseUrl: string,
  updates$: Observable<UpdateBatch>,
): Assets {
  const _def = {
    cache: {
      max: def?.cache?.max ?? 1000,
      ttl: def?.cache?.ttl,
    },
  };

  const projected = new ProjectedLazyMap<string, StoreAsset>({
    key: (asset) => asset.id,
    values: (ids) =>
      wrap('assets', () =>
        client.execute<StoreGetAssetsQuery>(ASSETS_QUERY, { filter: { ids } }).then((data) =>
          (data.contelloAssets ?? []).reduce<StoreAsset[]>((acc, raw) => {
            if (raw) {
              acc.push(mapAsset(raw));
            }

            return acc;
          }, []),
        ),
      ),
    cache: createLruCache({ max: _def.cache.max, ttl: _def.cache.ttl, onEvict: undefined }),
    protection: 'freeze',
  });

  const refresh$ = new Subject<string[]>();

  updates$.subscribe((batch) => {
    if (batch.asset.length === 0) return;

    for (const event of batch.asset) {
      projected.delete(event.id);
    }

    refresh$.next(batch.asset.map((e) => e.id));
  });

  return {
    refresh$: refresh$.asObservable(),

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },

    download(fileId: string): Promise<Response> {
      return fetch(`${baseUrl}/api/v1/assets/files/${fileId}`);
    },
  };
}
