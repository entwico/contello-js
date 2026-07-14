import type { ContelloClient, SourceDef } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { createLazyCollection } from './lazy-collection';
import { ModelResolver } from './model-resolver';
import type { RefreshEvent } from './types';
import type { UpdateBatch } from './watcher';

type Item = { id: string; value: number };

const source: SourceDef<'thing', 'entity', Item> = {
  document: '',
  fragment: 'Thing',
  subscription: 'things',
  __model: 'thing',
  __cardinality: 'entity',
};

type SubscribeCall = { ids?: string[] | undefined };

function makeClient(store: Item[]): {
  client: ContelloClient<any>;
  calls: SubscribeCall[];
} {
  const calls: SubscribeCall[] = [];

  const client = {
    subscribe<T>(_query: string, vars?: Record<string, unknown> | undefined): AsyncIterable<T> {
      const ids = vars?.['ids'] as string[] | undefined;

      calls.push({ ids });

      const filtered = ids ? store.filter((i) => ids.includes(i.id)) : store;

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

function entityBatch(model: string, id: string): UpdateBatch {
  return {
    entity: new Map([[model, [{ id, mutation: 'update', target: 'entity', model } as any]]]),
    events: [],
    route: [],
    asset: [],
    i18nMessage: [],
    routeByEntityModel: new Map(),
  } as unknown as UpdateBatch;
}

describe('lazy collection', () => {
  test('fetches a single id on demand and caches it', async () => {
    const { client, calls } = makeClient([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyCollection(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
    );

    const a = await Promise.resolve(instance.get('a'));

    expect(a).toEqual({ id: 'a', value: 1 });
    expect(calls).toEqual([{ ids: ['a'] }]);

    const again = instance.get('a');

    expect(again).toEqual({ id: 'a', value: 1 });
    expect(calls).toHaveLength(1);

    destroy();
  });

  test('fetches multiple ids in a single batch', async () => {
    const { client, calls } = makeClient([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyCollection(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
    );

    const items = await Promise.resolve(instance.get(['a', 'b']));

    expect(items).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
    expect(calls).toHaveLength(1);

    destroy();
  });

  test('applies the map function', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyCollection(
      source,
      { map: (raw) => ({ id: raw.id, value: raw.value * 10 }) },
      client,
      updates$,
      new ModelResolver(undefined),
    );

    expect(await Promise.resolve(instance.get('a'))).toEqual({ id: 'a', value: 10 });

    destroy();
  });

  test('an upstream update evicts the item and emits a refresh event', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyCollection(
      source,
      { onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
    );

    await Promise.resolve(instance.get('a'));

    updates$.next(entityBatch('thing', 'a'));

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'upstream-update' }));

    destroy();
  });

  test('an update for an unrelated model does not emit', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyCollection(
      source,
      { onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
    );

    await Promise.resolve(instance.get('a'));

    updates$.next(entityBatch('other', 'a'));

    await new Promise((r) => setTimeout(r, 0));
    expect(onRefresh).not.toHaveBeenCalled();

    destroy();
  });

  test('refresh() re-fetches cached keys', async () => {
    const store: Item[] = [{ id: 'a', value: 1 }];
    const { client, calls } = makeClient(store);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyCollection(
      source,
      { onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
    );

    expect(await Promise.resolve(instance.get('a'))).toEqual({ id: 'a', value: 1 });

    store[0]!.value = 99;
    instance.refresh();

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'on-demand' }));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(await Promise.resolve(instance.get('a'))).toEqual({ id: 'a', value: 99 });

    destroy();
  });

  test('refresh() on an empty cache is a no-op', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createLazyCollection(
      source,
      { onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
    );

    instance.refresh();

    await new Promise((r) => setTimeout(r, 0));
    expect(onRefresh).not.toHaveBeenCalled();

    destroy();
  });

  test('clear() drops the cache so the next get refetches', async () => {
    const { client, calls } = makeClient([{ id: 'a', value: 1 }]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyCollection(
      source,
      undefined,
      client,
      updates$,
      new ModelResolver(undefined),
    );

    await Promise.resolve(instance.get('a'));
    expect(calls).toHaveLength(1);

    instance.clear();

    await Promise.resolve(instance.get('a'));
    expect(calls).toHaveLength(2);

    destroy();
  });
});
