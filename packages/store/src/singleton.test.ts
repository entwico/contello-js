import type { ContelloClient, SourceDef } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ModelResolver } from './model-resolver';
import { createSingleton, createSingletonSync } from './singleton';
import type { SingletonRefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type Config = { title: string; version: number };

const source: SourceDef<'config', 'singleton', Config> = {
  document: '',
  fragment: 'Config',
  subscription: 'config',
  __model: 'config',
  __cardinality: 'singleton',
};

function makeClient(valuesByCall: Config[]): {
  client: ContelloClient<any>;
  callCount: () => number;
} {
  let callIndex = 0;

  const client = {
    subscribe<T>(): AsyncIterable<T> {
      const value = valuesByCall[callIndex] ?? valuesByCall.at(-1)!;

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

              return { value: { source: value } as unknown as T, done: false };
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

function ownModelBatch(model: string): UpdateBatch {
  return {
    entity: new Map([[model, [{ id: 'x', mutation: 'update', target: 'entity', model } as any]]]),
    events: [],
    route: [],
    asset: [],
    i18nMessage: [],
    routeByEntityModel: new Map(),
  } as unknown as UpdateBatch;
}

describe('singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('loads and returns the mapped value', async () => {
    const { client, callCount } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onLoad = vi.fn<() => void>();

    const { instance, destroy } = createSingleton(
      source,
      { map: (raw) => raw.title.toUpperCase(), onLoad },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    expect(callCount()).toBe(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(await Promise.resolve(instance.get())).toBe('A');

    destroy();
  });

  test('identity map is used when no map is provided', async () => {
    const { client } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createSingleton(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    expect(await Promise.resolve(instance.get())).toEqual({ title: 'a', version: 1 });

    destroy();
  });

  test('name falls back to the model name', async () => {
    const { client } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createSingleton(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    expect(instance.name).toBe('config');

    destroy();
  });

  test('load is a no-op on second call', async () => {
    const { client, callCount } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createSingleton(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    await instance.load();

    expect(callCount()).toBe(1);

    destroy();
  });

  test('refresh() refetches and emits an on-demand event', async () => {
    const { client, callCount } = makeClient([
      { title: 'a', version: 1 },
      { title: 'b', version: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: SingletonRefreshEvent) => void>();

    const { instance, destroy } = createSingleton(
      source,
      { onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    instance.refresh();

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ kind: 'on-demand' }));
    expect(callCount()).toBe(2);
    expect(await Promise.resolve(instance.get())).toEqual({ title: 'b', version: 2 });

    destroy();
  });

  test('ttl fires a periodic refresh', async () => {
    const { client, callCount } = makeClient([
      { title: 'a', version: 1 },
      { title: 'b', version: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: SingletonRefreshEvent) => void>();

    const { instance, destroy } = createSingleton(
      source,
      { cache: { ttl: 1000 }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(callCount()).toBe(2));
    expect(onRefresh).toHaveBeenLastCalledWith({ kind: 'ttl' });

    destroy();
  });

  test('an upstream update for the own model triggers a refresh', async () => {
    const { client, callCount } = makeClient([
      { title: 'a', version: 1 },
      { title: 'b', version: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: SingletonRefreshEvent) => void>();

    const { instance, destroy } = createSingleton(
      source,
      { cache: { ttl: false }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    updates$.next(ownModelBatch('config'));

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ kind: 'upstream-update' }));
    expect(callCount()).toBe(2);

    destroy();
  });

  test('updates before load are ignored', async () => {
    const { client, callCount } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { destroy } = createSingleton(
      source,
      { cache: { ttl: false } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    updates$.next(ownModelBatch('config'));

    await vi.advanceTimersByTimeAsync(0);
    expect(callCount()).toBe(0);

    destroy();
  });

  test('eviction \'clear\' drops the value and the next get refetches', async () => {
    const { client, callCount } = makeClient([
      { title: 'a', version: 1 },
      { title: 'b', version: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createSingleton(
      source,
      { cache: { ttl: false, eviction: 'clear' } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    updates$.next(ownModelBatch('config'));

    await vi.advanceTimersByTimeAsync(0);
    expect(callCount()).toBe(1);

    expect(await Promise.resolve(instance.get())).toEqual({ title: 'b', version: 2 });
    expect(callCount()).toBe(2);

    destroy();
  });
});

describe('singleton sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('get throws before load and returns a sync value after', async () => {
    const { client } = makeClient([{ title: 'a', version: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createSingletonSync(
      source,
      { name: 'settings' },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    expect(() => instance.get()).toThrow(/not initialized yet/);

    await instance.load();

    expect(instance.get()).toEqual({ title: 'a', version: 1 });

    destroy();
  });
});
