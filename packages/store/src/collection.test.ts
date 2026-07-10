import type { ContelloClient, SourceDef } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createCollection } from './collection';
import { ModelResolver } from './model-resolver';
import type { RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type Item = { id: string; value: number };

const source: SourceDef<'thing', 'entity', Item> = {
  document: '',
  fragment: 'Thing',
  subscription: 'things',
  __model: 'thing',
  __cardinality: 'entity',
};

function makeClient(itemsByCall: Item[][]): {
  client: ContelloClient<any>;
  callCount: () => number;
} {
  let callIndex = 0;

  const client = {
    subscribe<T>(_query: string, _variables?: Record<string, unknown> | undefined): AsyncIterable<T> {
      const items = itemsByCall[callIndex] ?? itemsByCall.at(-1)!;

      callIndex += 1;

      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          let yielded = false;

          return {
            async next(): Promise<IteratorResult<T>> {
              if (yielded) {
                return { value: undefined as unknown as T, done: true };
              }

              yielded = true;

              return { value: { source: items } as unknown as T, done: false };
            },
            async return(): Promise<IteratorResult<T>> {
              return { value: undefined as unknown as T, done: true };
            },
          };
        },
      };
    },
  } as unknown as ContelloClient<any>;

  return { client, callCount: () => callIndex };
}

describe('collection refresh-by-ttl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('fires a full refresh after ttl elapses', async () => {
    const { client, callCount } = makeClient([[{ id: 'a', value: 1 }], [{ id: 'a', value: 2 }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const refreshByTtl = createRefreshByTtlQueue();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: 1000 }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      refreshByTtl,
    );

    await instance.load();
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'ttl' });

    destroy();
  });

  test('default ttl is applied when cache.ttl is not set', async () => {
    const { client, callCount } = makeClient([[{ id: 'a', value: 1 }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createCollection(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    // 3h - 1s — should NOT have fired yet
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 - 1000);
    expect(callCount()).toBe(1);

    // cross the 3h mark
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    destroy();
  });

  test('ttl: 0 disables periodic refresh', async () => {
    const { client, callCount } = makeClient([[{ id: 'a', value: 1 }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: 0 } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    // advance well past the default ttl — no follow-up refresh should fire
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(callCount()).toBe(1);

    destroy();
  });

  test('ttl: false disables periodic refresh', async () => {
    const { client, callCount } = makeClient([[{ id: 'a', value: 1 }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: false } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(callCount()).toBe(1);

    destroy();
  });

  test('first get() (no explicit load) still arms ttl and enables update events', async () => {
    const { client, callCount } = makeClient([[{ id: 'a', value: 1 }], [{ id: 'a', value: 2 }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onLoad = vi.fn<(ids: string[]) => void>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: 1000 }, onLoad, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    // skip load() — pull data via get() instead. lazy projected fetch fires under the hood.
    const a = await Promise.resolve(instance.get('a'));

    expect(a).toEqual({ id: 'a', value: 1 });
    expect(callCount()).toBe(1);
    expect(onLoad).toHaveBeenCalledWith(['a']);

    // ttl timer should be armed — advance past it and verify a full refresh fires
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    destroy();
  });

  test('partial refresh from update event does NOT reset the ttl timer', async () => {
    const { client, callCount } = makeClient([
      [{ id: 'a', value: 1 }],
      [{ id: 'a', value: 2 }],
      [{ id: 'a', value: 3 }],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const refreshByTtl = createRefreshByTtlQueue();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: 10_000 } },
      client,
      updates$,
      new ModelResolver(undefined),
      refreshByTtl,
    );

    await instance.load();
    expect(callCount()).toBe(1);

    // halfway through the ttl window, an update event arrives — triggers a partial refresh
    await vi.advanceTimersByTimeAsync(5000);
    updates$.next({
      entity: new Map([['thing', [{ id: 'a', mutation: 'update' } as any]]]),
      events: [],
      route: [],
      asset: [],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(callCount()).toBe(2));

    // the ttl timer should still fire at t=10_000, not t=15_000 — partial doesn't reset it
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(callCount()).toBe(3));

    destroy();
  });

  test('refresh events carry the right kind for each trigger', async () => {
    const { client } = makeClient([
      [{ id: 'a', value: 1 }],
      [{ id: 'a', value: 2 }],
      [{ id: 'a', value: 3 }],
      [{ id: 'a', value: 4 }],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createCollection(
      source,
      { cache: { ttl: 1000 }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    // 1. ttl-driven full refresh
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['a'], kind: 'ttl' });

    // 2. consumer-called refresh()
    instance.refresh();
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['a'], kind: 'on-demand' });

    // 3. upstream update event → partial refresh
    updates$.next({
      entity: new Map([['thing', [{ id: 'a', mutation: 'update' } as any]]]),
      events: [],
      route: [],
      asset: [],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['a'], kind: 'upstream-update' });

    destroy();
  });
});
