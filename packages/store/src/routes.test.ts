import type { ContelloClient } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createLazyRoutesCollection } from './lazy-routes';
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
      const paths = vars?.['paths'] as string[] | undefined;
      const allRoutes = snapshotByCall[Math.min(callIndex, snapshotByCall.length - 1)]!;

      callIndex += 1;

      const filtered = ids
        ? allRoutes.filter((r) => ids.includes(r.id))
        : (paths
            ? allRoutes.filter((r) => paths.includes(r.path))
            : allRoutes);

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

  test('a route is found by every spelling of its path', async () => {
    const { client } = makeClient([[makeRoute('1', '/über-uns'), makeRoute('2', '/magazin/fu%cc%88r')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createRoutesCollection(
      { cache: { ttl: false } },
      client,
      updates$,
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    await instance.load();

    for (const spelling of ['/über-uns', '/u\u{0308}ber-uns', '/%C3%BCber-uns', '/%c3%bcber-uns']) {
      expect((instance.getByPath(spelling) as StoreRoute | undefined)?.id, spelling).toBe('1');
    }

    // a path a core stored before it normalized them is indexed under the normalized form
    expect((instance.getByPath('/magazin/für') as StoreRoute | undefined)?.id).toBe('2');
    expect((instance.getByPath(['/%C3%BCber-uns', '/magazin/f%C3%BCr']) as StoreRoute[]).map((r) => r.id)).toEqual(['1', '2']);

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

describe('lazy routes', () => {
  test('a missed path lookup is cached and answered sync without refetching', async () => {
    const { client, callCount } = makeClient([[makeRoute('1', '/home')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyRoutesCollection(undefined, client, updates$, new ModelResolver(undefined));

    const missing = await Promise.resolve(instance.getByPath('/nope'));

    expect(missing).toBeUndefined();
    expect(callCount()).toBe(1);

    const again = instance.getByPath('/nope');

    expect(again).toBeUndefined();
    expect(callCount()).toBe(1);

    destroy();
  });

  test('every spelling of a path shares one cache entry and one fetch', async () => {
    const { client, calls, callCount } = makeClient([[makeRoute('1', '/über-uns')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyRoutesCollection(undefined, client, updates$, new ModelResolver(undefined));

    const encoded = await Promise.resolve(instance.getByPath('/%C3%BCber-uns'));

    expect((encoded as StoreRoute).id).toBe('1');
    expect(callCount()).toBe(1);
    // core is asked for the stored form
    expect(calls[0]?.vars?.paths).toEqual(['/über-uns']);

    expect((instance.getByPath('/über-uns') as unknown as StoreRoute | undefined)?.id).toBe('1');
    expect((instance.getByPath('/u\u{0308}ber-uns') as unknown as StoreRoute | undefined)?.id).toBe('1');
    expect(callCount()).toBe(1);

    // a miss in one spelling is a miss in every spelling
    expect(await Promise.resolve(instance.getByPath('/%C3%BCbersicht'))).toBeUndefined();
    expect(callCount()).toBe(2);
    expect(instance.getByPath('/übersicht')).toBeUndefined();
    expect(callCount()).toBe(2);

    destroy();
  });

  test('a route update event drops the negative entry for its path', async () => {
    const { client, callCount } = makeClient([[], [makeRoute('1', '/late')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyRoutesCollection(undefined, client, updates$, new ModelResolver(undefined));

    expect(await Promise.resolve(instance.getByPath('/late'))).toBeUndefined();
    expect(callCount()).toBe(1);
    expect(instance.getByPath('/late')).toBeUndefined();

    updates$.next({
      entity: new Map(),
      events: [],
      route: [
        {
          id: '1',
          mutation: 'update',
          target: 'route',
          after: { id: '1', path: '/late', type: 'textResponse' },
          before: undefined,
        } as any,
      ],
      asset: [],
      i18nMessage: [],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    const found = await Promise.resolve(instance.getByPath('/late'));

    expect((found as StoreRoute).id).toBe('1');
    expect(callCount()).toBe(2);

    destroy();
  });

  test('refresh() clears negative entries', async () => {
    const { client, callCount } = makeClient([[], [makeRoute('1', '/later')]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const { instance, destroy } = createLazyRoutesCollection(undefined, client, updates$, new ModelResolver(undefined));

    expect(await Promise.resolve(instance.getByPath('/later'))).toBeUndefined();
    expect(callCount()).toBe(1);

    instance.refresh();

    const found = await Promise.resolve(instance.getByPath('/later'));

    expect((found as StoreRoute).id).toBe('1');

    destroy();
  });
});
