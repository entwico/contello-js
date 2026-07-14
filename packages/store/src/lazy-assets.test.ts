import type { ContelloClient } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { type StoreAsset, createLazyAssetsCollection } from './lazy-assets';
import type { RefreshEvent } from './types';
import type { UpdateBatch } from './watcher';

type RawAsset = {
  id: string;
  original: { uid: string; mimeType: string; metadata: { width: number; height: number } | null };
  preview: { uid: string; mimeType: string; metadata: null } | null;
  optimized: { uid: string; mimeType: string; metadata: null }[];
};

function makeAsset(id: string): RawAsset {
  return {
    id,
    original: { uid: `${id}-uid`, mimeType: 'image/png', metadata: { width: 100, height: 50 } },
    preview: null,
    optimized: [],
  };
}

type SubscribeCall = { ids?: string[] | undefined };

function makeClient(store: RawAsset[]): {
  client: ContelloClient<any>;
  calls: SubscribeCall[];
} {
  const calls: SubscribeCall[] = [];

  const client = {
    subscribe<T>(_query: string, vars?: Record<string, unknown> | undefined): AsyncIterable<T> {
      const ids = vars?.['ids'] as string[] | undefined;

      calls.push({ ids });

      const filtered = ids ? store.filter((a) => ids.includes(a.id)) : store;

      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          let yielded = false;

          return {
            async next(): Promise<IteratorResult<T>> {
              if (yielded) {
                return { value: undefined as unknown as T, done: true };
              }

              yielded = true;

              return { value: { source: filtered } as unknown as T, done: false };
            },
            async return(): Promise<IteratorResult<T>> {
              return { value: undefined as unknown as T, done: true };
            },
          };
        },
      };
    },
  } as unknown as ContelloClient<any>;

  return { client, calls };
}

function assetBatch(...ids: string[]): UpdateBatch {
  return {
    entity: new Map(),
    events: [],
    route: [],
    asset: ids.map((id) => ({ id, mutation: 'update', target: 'asset' }) as any),
    i18nMessage: [],
    routeByEntityModel: new Map(),
  } as unknown as UpdateBatch;
}

describe('lazy assets', () => {
  test('fetches and maps an asset on demand', async () => {
    const { client, calls } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyAssetsCollection(undefined, client, updates$);

    const asset = (await instance.get('a')) as StoreAsset;

    expect(asset).toEqual({
      id: 'a',
      original: { uid: 'a-uid', mimeType: 'image/png', metadata: { width: 100, height: 50 } },
      preview: undefined,
      optimized: [],
    });
    expect(calls).toEqual([{ ids: ['a'] }]);

    destroy();
  });

  test('caches subsequent lookups', async () => {
    const { client, calls } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyAssetsCollection(undefined, client, updates$);

    await instance.get('a');
    await instance.get('a');

    expect(calls).toHaveLength(1);

    destroy();
  });

  test('fetches multiple ids in a single batch', async () => {
    const { client, calls } = makeClient([makeAsset('a'), makeAsset('b')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyAssetsCollection(undefined, client, updates$);

    const assets = await instance.get(['a', 'b']);

    expect(assets.map((a) => a.id)).toEqual(['a', 'b']);
    expect(calls).toHaveLength(1);

    destroy();
  });

  test('an asset update evicts the entry and emits a refresh', async () => {
    const { client } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyAssetsCollection({ onRefresh }, client, updates$);

    await instance.get('a');

    updates$.next(assetBatch('a'));

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'upstream-update' }));

    destroy();
  });

  test('a batch with no asset events does not emit', async () => {
    const { client } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyAssetsCollection({ onRefresh }, client, updates$);

    await instance.get('a');

    updates$.next(assetBatch());

    await new Promise((r) => setTimeout(r, 0));
    expect(onRefresh).not.toHaveBeenCalled();

    destroy();
  });

  test('refresh() re-fetches cached ids', async () => {
    const { client, calls } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyAssetsCollection({ onRefresh }, client, updates$);

    await instance.get('a');

    instance.refresh();

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'on-demand' }));
    expect(calls.length).toBeGreaterThanOrEqual(2);

    destroy();
  });

  test('clear() drops the cache so the next get refetches', async () => {
    const { client, calls } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyAssetsCollection(undefined, client, updates$);

    await instance.get('a');
    expect(calls).toHaveLength(1);

    instance.clear();

    await instance.get('a');
    expect(calls).toHaveLength(2);

    destroy();
  });

  test('upload / download / proxyHls delegate to the client', async () => {
    const { client } = makeClient([makeAsset('a')]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const upload = vi.fn(() => Promise.resolve('uploaded-id'));
    const download = vi.fn(() => Promise.resolve({ stream: () => new ReadableStream(), mimeType: 'image/png', size: 0 }));
    const proxyHls = vi.fn(() =>
      Promise.resolve({ stream: () => new ReadableStream(), status: 200, headers: new Headers() }),
    );

    (client as unknown as { upload: typeof upload }).upload = upload;
    (client as unknown as { download: typeof download }).download = download;
    (client as unknown as { proxyHls: typeof proxyHls }).proxyHls = proxyHls;

    const { instance, destroy } = createLazyAssetsCollection(undefined, client, updates$);

    await expect(instance.upload({} as any, {} as any)).resolves.toBe('uploaded-id');
    expect(upload).toHaveBeenCalledTimes(1);

    await instance.download('file-id');
    expect(download).toHaveBeenCalledWith('file-id');

    await instance.proxyHls('/some/path');
    expect(proxyHls).toHaveBeenCalledWith('/some/path', undefined);

    destroy();
  });
});
