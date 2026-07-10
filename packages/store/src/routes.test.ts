import type { ContelloClient } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ModelResolver } from './model-resolver';
import { createRoutesCollection, createRoutesSyncCollection } from './routes';
import type { StoreRoute } from './routes-mapping';
import type { RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type RawRoute = {
  __typename: 'ContelloRoute';
  id: string;
  path: string;
  customHeaders: never[];
  target: {
    __typename: 'ContelloRouteTargetText';
    content: string;
    mimeType: string;
  };
};

function makeRoute(id: string, path: string): RawRoute {
  return {
    __typename: 'ContelloRoute',
    id,
    path,
    customHeaders: [],
    target: {
      __typename: 'ContelloRouteTargetText',
      content: id,
      mimeType: 'text/plain',
    },
  };
}

type SubscribeCall = { vars?: { ids?: string[]; paths?: string[] } | undefined };

function makeClient(snapshotByCall: RawRoute[][]): {
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
      const allRoutes = snapshotByCall[Math.min(callIndex, snapshotByCall.length - 1)]!;

      callIndex += 1;

      const filtered = ids ? allRoutes.filter((r) => ids.includes(r.id)) : allRoutes;

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

describe('eager routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('full fetch on first access; sync lookup by id and path', async () => {
    const { client, callCount } = makeClient([[makeRoute('1', '/home'), makeRoute('2', '/about')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onLoad = vi.fn<(ids: string[]) => void>();

    const { instance, destroy } = createRoutesCollection(
      { cache: { ttl: false }, onLoad },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    const home = await Promise.resolve(instance.getByPath('/home'));

    expect((home as StoreRoute).id).toBe('1');
    expect(callCount()).toBe(1);
    expect(onLoad).toHaveBeenCalledWith(['1', '2']);

    // subsequent lookups are sync (already-resolved projected returns sync values)
    const about = instance.getByPath('/about') as StoreRoute | undefined;

    expect(about?.id).toBe('2');

    destroy();
  });

  test('getByPath for unknown path returns undefined without hitting the server', async () => {
    const { client, callCount } = makeClient([[makeRoute('1', '/home')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createRoutesCollection(
      { cache: { ttl: false } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    const missing = instance.getByPath('/does-not-exist');

    expect(missing).toBeUndefined();
    expect(callCount()).toBe(1);

    destroy();
  });

  test('update event refetches only the changed ids; path index syncs', async () => {
    const { client, calls } = makeClient([
      [makeRoute('1', '/home'), makeRoute('2', '/about')],
      [makeRoute('1', '/home'), makeRoute('2', '/about-us')], // partial: id 2's path changed
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createRoutesCollection(
      { cache: { ttl: false }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(calls).toEqual([{ vars: { ids: undefined } }]);

    updates$.next({
      entity: new Map(),
      events: [],
      route: [
        {
          id: '2',
          mutation: 'update',
          target: 'route',
          after: { id: '2', path: '/about-us', type: 'textResponse' },
          before: { id: '2', path: '/about', type: 'textResponse' },
        } as any,
      ],
      asset: [],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    // partial fetch carried only the changed id
    expect(calls[1]).toEqual({ vars: { ids: ['2'] } });
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['2'], kind: 'upstream-update' });

    // path index swapped: /about is gone, /about-us resolves
    expect(instance.getByPath('/about')).toBeUndefined();
    expect((instance.getByPath('/about-us') as StoreRoute).id).toBe('2');

    destroy();
  });

  test('delete event removes route locally without a follow-up fetch', async () => {
    const { client, callCount } = makeClient([[makeRoute('1', '/home'), makeRoute('2', '/about')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();

    const { instance, destroy } = createRoutesCollection(
      { cache: { ttl: false }, onRefresh },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();
    expect(callCount()).toBe(1);

    updates$.next({
      entity: new Map(),
      events: [],
      route: [{ id: '2', mutation: 'delete', target: 'route' } as any],
      asset: [],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    expect(callCount()).toBe(1); // no follow-up fetch
    expect(instance.getByPath('/about')).toBeUndefined();
    expect((instance.getByPath('/home') as StoreRoute).id).toBe('1');

    destroy();
  });
});

describe('routes sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('get / getByPath throw before load(); return sync values after', async () => {
    const { client } = makeClient([[makeRoute('1', '/home')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createRoutesSyncCollection(
      { cache: { ttl: false } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    expect(() => instance.getByPath('/home')).toThrow(/not initialized yet/);

    await instance.load();

    expect((instance.getByPath('/home') as StoreRoute).id).toBe('1');
    expect(instance.getByPath('/missing')).toBeUndefined();

    destroy();
  });
});
