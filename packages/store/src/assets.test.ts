import type { ContelloClient } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createAssetsCollection, createAssetsSyncCollection } from './assets';
import type { StoreAsset } from './lazy-assets';
import type { RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type RawAsset = {
  __typename?: 'ContelloAsset';
  id: string;
  original: { uid: string; mimeType: string; metadata: null };
  preview: null;
  optimized: never[];
};

function makeAsset(id: string): RawAsset {
  return {
    __typename: 'ContelloAsset',
    id,
    original: { uid: `${id}-uid`, mimeType: 'image/png', metadata: null },
    preview: null,
    optimized: [],
  };
}

type SubscribeCall = { vars?: { ids?: string[] } | undefined };

function makeClient(snapshotByCall: RawAsset[][]): {
  client: ContelloClient<any>;
  calls: SubscribeCall[];
  callCount: () => number;
} {
  let callIndex = 0;
  const calls: SubscribeCall[] = [];

  const client = {
    subscribe<T>(_query: string, vars?: Record<string, unknown> | undefined): AsyncIterable<T> {
      calls.push({ vars: vars as SubscribeCall['vars'] });

      const ids = vars?.['ids'] as string[] | undefined;
      const all = snapshotByCall[Math.min(callIndex, snapshotByCall.length - 1)]!;

      callIndex += 1;

      const filtered = ids ? all.filter((a) => ids.includes(a.id)) : all;

      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          let yielded = false;

          return {
            async next(): Promise<IteratorResult<T>> {
              if (yielded) return { value: undefined as unknown as T, done: true };
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

  return { client, calls, callCount: () => callIndex };
}

describe('eager assets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('full fetch on first access; subsequent lookups are sync', async () => {
    const { client, callCount } = makeClient([[makeAsset('1'), makeAsset('2')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onLoad = vi.fn<(ids: string[]) => void>();

    const { instance, destroy } = createAssetsCollection(
      { cache: { ttl: false }, onLoad },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    const first = await Promise.resolve(instance.get('1'));

    expect((first as StoreAsset).id).toBe('1');
    expect(callCount()).toBe(1);
    expect(onLoad).toHaveBeenCalledWith(['1', '2']);

    // already resolved → sync read
    const second = instance.get('2') as StoreAsset | undefined;

    expect(second?.id).toBe('2');

    destroy();
  });

  test('update event refetches only the changed ids', async () => {
    const { client, calls } = makeClient([
      [makeAsset('1'), makeAsset('2')],
      [makeAsset('1'), makeAsset('2')], // partial: id 2 unchanged shape, but server still queried for it
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createAssetsCollection(
      { cache: { ttl: false }, onRefresh },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(calls).toEqual([{ vars: { ids: undefined } }]);

    updates$.next({
      entity: new Map(),
      events: [],
      route: [],
      asset: [{ id: '2', mutation: 'update', target: 'asset' } as any],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(calls[1]).toEqual({ vars: { ids: ['2'] } });
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['2'], kind: 'upstream-update' });

    destroy();
  });

  test('delete event removes locally without a follow-up fetch', async () => {
    const { client, callCount } = makeClient([[makeAsset('1'), makeAsset('2')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createAssetsCollection(
      { cache: { ttl: false }, onRefresh },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    updates$.next({
      entity: new Map(),
      events: [],
      route: [],
      asset: [{ id: '2', mutation: 'delete', target: 'asset' } as any],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(callCount()).toBe(1); // no follow-up fetch
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['2'], kind: 'upstream-update' });
    expect(instance.get('2')).toBeUndefined();
    expect((instance.get('1') as StoreAsset).id).toBe('1');

    destroy();
  });

  test('ttl fires a periodic full refresh', async () => {
    const { client, callCount } = makeClient([[makeAsset('1')], [makeAsset('1')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createAssetsCollection(
      { cache: { ttl: 1000 } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    destroy();
  });
});

describe('assets sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('get throws before load(); returns sync values after', async () => {
    const { client } = makeClient([[makeAsset('1')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createAssetsSyncCollection(
      { cache: { ttl: false } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    expect(() => instance.get('1')).toThrow(/not initialized yet/);

    await instance.load();

    expect((instance.get('1') as StoreAsset).id).toBe('1');
    expect(instance.get('missing')).toBeUndefined();

    destroy();
  });

  test('upload / download / proxyHls are passthrough to the client', async () => {
    const { client } = makeClient([[makeAsset('1')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const upload = vi.fn(() => Promise.resolve('uploaded-id'));
    const download = vi.fn(() =>
      Promise.resolve({ stream: () => new ReadableStream(), mimeType: 'image/png', size: 0 }),
    );
    const proxyHls = vi.fn(() =>
      Promise.resolve({ stream: () => new ReadableStream(), status: 200, headers: new Headers() }),
    );

    (client as unknown as { upload: typeof upload }).upload = upload;
    (client as unknown as { download: typeof download }).download = download;
    (client as unknown as { proxyHls: typeof proxyHls }).proxyHls = proxyHls;

    const { instance, destroy } = createAssetsSyncCollection(
      { cache: { ttl: false } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await instance.upload({} as any, {} as any);
    expect(upload).toHaveBeenCalledTimes(1);

    await instance.download('file-id');
    expect(download).toHaveBeenCalledWith('file-id');

    await instance.proxyHls('/some/path');
    expect(proxyHls).toHaveBeenCalledWith('/some/path', undefined);

    destroy();
  });
});
