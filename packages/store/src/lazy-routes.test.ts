import { createFakeContelloClient } from '@contello/client/testing';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { type LazyRoutesOptions, createLazyRoutesCollection } from './lazy-routes';
import { ModelResolver } from './model-resolver';
import type { StoreRoute } from './routes-mapping';
import type { RefreshEvent } from './types';
import type { UpdateBatch, UpdateEventFor } from './watcher';

type RawRoute = {
  __typename: 'ContelloRoute';
  id: string;
  path: string;
  customHeaders: { name: string; value: string }[];
  target: Record<string, unknown>;
};

function textRoute(id: string, path: string, content = id): RawRoute {
  return {
    __typename: 'ContelloRoute',
    id,
    path,
    customHeaders: [],
    target: { __typename: 'ContelloRouteTargetText', content, mimeType: 'text/plain' },
  };
}

function mapped(id: string, path: string, content = id): StoreRoute {
  return { id, path, customHeaders: [], type: 'text', content, mimeType: 'text/plain' };
}

function routeBatch(...route: UpdateEventFor<'route'>[]): UpdateBatch {
  return { events: route, route, asset: [], i18nMessage: [], entity: new Map(), routeByEntityModel: new Map() };
}

type Fetch = { ids?: string[] | undefined; paths?: string[] | undefined };

function setup(
  initial: RawRoute[],
  options?: (LazyRoutesOptions & { models?: Record<string, string> | undefined }) | undefined,
) {
  const upstream = new Map(initial.map((route) => [route.id, route]));
  const fetches: Fetch[] = [];

  const { client } = createFakeContelloClient({
    subscribe(_query, variables) {
      const { ids, paths } = (variables ?? {}) as Fetch;
      const all = upstream.values().toArray();

      fetches.push({ ...(ids && { ids }), ...(paths && { paths }) });

      return { source: all.filter((route) => ids?.includes(route.id) ?? paths?.includes(route.path) ?? true) };
    },
  });

  const updates$ = createAsyncIterableSubject<UpdateBatch>();
  const resolver = new ModelResolver(options?.models);
  const { instance, destroy } = createLazyRoutesCollection(options, client, updates$, resolver);

  return { routes: instance, destroy, upstream, fetches, updates$ };
}

describe('lazy routes lookups', () => {
  test('fetches a route by id on demand and caches it', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/home'), textRoute('2', '/about')]);

    expect(await routes.get('1')).toEqual(mapped('1', '/home'));
    expect(await routes.get('1')).toEqual(mapped('1', '/home'));

    expect(fetches).toEqual([{ ids: ['1'] }]);

    destroy();
  });

  test('fetches several ids in one request and leaves out the unknown ones', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/home'), textRoute('2', '/about')]);

    const found = await routes.get(['1', 'missing', '2']);

    expect(found.map((route) => route.id)).toEqual(['1', '2']);
    expect(fetches).toEqual([{ ids: ['1', 'missing', '2'] }]);

    destroy();
  });

  test('fetches several paths in one request', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/home'), textRoute('2', '/about')]);

    const found = await routes.getByPath(['/about', '/home']);

    expect(new Set(found.map((route) => route.id))).toEqual(new Set(['1', '2']));
    expect(fetches).toEqual([{ paths: ['/about', '/home'] }]);

    destroy();
  });

  test('a route fetched by path is cached for its id, and the other way round', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/home'), textRoute('2', '/about')]);

    await routes.getByPath('/home');
    expect(await routes.get('1')).toEqual(mapped('1', '/home'));

    await routes.get('2');
    expect(await routes.getByPath('/about')).toEqual(mapped('2', '/about'));

    expect(fetches).toEqual([{ paths: ['/home'] }, { ids: ['2'] }]);

    destroy();
  });

  test('a missed id is remembered and not asked for again', async () => {
    const { routes, fetches, destroy } = setup([]);

    expect(await routes.get('missing')).toBeUndefined();
    expect(await routes.get('missing')).toBeUndefined();
    expect(await routes.get(['missing'])).toEqual([]);

    expect(fetches).toEqual([{ ids: ['missing'] }]);

    destroy();
  });

  test('a route to an entity carries the model, a route whose entity is gone is no route', async () => {
    const withEntity = (id: string, entity: unknown): RawRoute => ({
      ...textRoute(id, `/${id}`),
      target: { __typename: 'ContelloRouteTargetEntity', entity },
    });

    const { routes, fetches, destroy } = setup(
      [withEntity('1', { __typename: 'ArticleEntity', id: 'article-1' }), withEntity('2', null)],
      { models: { article: 'ArticleEntity' } },
    );

    expect(await routes.get('1')).toEqual({
      id: '1',
      path: '/1',
      customHeaders: [],
      type: 'entity',
      model: 'article',
      entityType: 'ArticleEntity',
      entityId: 'article-1',
    });
    expect(await routes.get('2')).toBeUndefined();
    expect(await routes.get('2')).toBeUndefined();

    expect(fetches).toHaveLength(2);

    destroy();
  });
});

describe('lazy routes cache bounds', () => {
  test('the least recently used route makes room, for its id and its path', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/one'), textRoute('2', '/two')], { cache: { max: 1 } });

    await routes.get('1');
    await routes.get('2');
    await routes.getByPath('/one');
    await routes.getByPath('/one');

    expect(fetches).toEqual([{ ids: ['1'] }, { ids: ['2'] }, { paths: ['/one'] }]);

    destroy();
  });

  test('clear() drops routes and remembered misses', async () => {
    const { routes, fetches, destroy } = setup([textRoute('1', '/home')]);

    await routes.get('1');
    await routes.get('missing');

    routes.clear();

    await routes.get('1');
    await routes.get('missing');

    expect(fetches).toHaveLength(4);

    destroy();
  });
});

describe('lazy routes upstream updates', () => {
  test('an updated route replaces the cached one without a fetch', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, fetches, updates$, destroy } = setup([textRoute('1', '/home', 'old')], { onRefresh });

    await routes.get('1');

    updates$.next(
      routeBatch({
        id: '1',
        mutation: 'update',
        target: 'route',
        before: mapped('1', '/home', 'old'),
        after: mapped('1', '/home', 'new'),
      }),
    );

    expect(await routes.get('1')).toEqual(mapped('1', '/home', 'new'));
    expect(await routes.getByPath('/home')).toEqual(mapped('1', '/home', 'new'));

    expect(fetches).toHaveLength(1);
    expect(onRefresh).toHaveBeenCalledWith({ ids: ['1'], kind: 'upstream-update' });

    destroy();
  });

  test('a route that moved is found at its new path and no longer at the old one', async () => {
    const { routes, fetches, upstream, updates$, destroy } = setup([textRoute('1', '/old')]);

    await routes.getByPath('/old');

    upstream.set('1', textRoute('1', '/new'));
    updates$.next(
      routeBatch({
        id: '1',
        mutation: 'update',
        target: 'route',
        before: mapped('1', '/old'),
        after: mapped('1', '/new'),
      }),
    );

    expect(await routes.getByPath('/new')).toEqual(mapped('1', '/new'));
    expect(fetches).toHaveLength(1);

    expect(await routes.getByPath('/old')).toBeUndefined();
    expect(fetches).toEqual([{ paths: ['/old'] }, { paths: ['/old'] }]);

    destroy();
  });

  test('an update of a route that is not cached does not cache it', async () => {
    const { routes, fetches, updates$, destroy } = setup([textRoute('1', '/home')]);

    updates$.next(routeBatch({ id: '1', mutation: 'create', target: 'route', after: mapped('1', '/home', 'event') }));

    expect(await routes.get('1')).toEqual(mapped('1', '/home'));
    expect(fetches).toEqual([{ ids: ['1'] }]);

    destroy();
  });

  test('a deleted route leaves the cache, for its id and its path', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, fetches, upstream, updates$, destroy } = setup([textRoute('1', '/home')], { onRefresh });

    await routes.get('1');

    upstream.delete('1');
    updates$.next(routeBatch({ id: '1', mutation: 'delete', target: 'route' }));

    expect(onRefresh).toHaveBeenCalledWith({ ids: ['1'], kind: 'upstream-update' });

    expect(await routes.get('1')).toBeUndefined();
    expect(await routes.getByPath('/home')).toBeUndefined();

    expect(fetches).toEqual([{ ids: ['1'] }, { ids: ['1'] }, { paths: ['/home'] }]);

    destroy();
  });

  test('a batch without route events emits nothing', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, updates$, destroy } = setup([textRoute('1', '/home')], { onRefresh });

    await routes.get('1');

    updates$.next(routeBatch());

    expect(onRefresh).not.toHaveBeenCalled();

    destroy();
  });

  test('ignores updates after destroy', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, updates$, destroy } = setup([textRoute('1', '/home')], { onRefresh });

    await routes.get('1');

    destroy();
    updates$.next(routeBatch({ id: '1', mutation: 'delete', target: 'route' }));

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('lazy routes refresh', () => {
  test('refresh() fetches the cached routes again and reports their ids', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, fetches, upstream, destroy } = setup([textRoute('1', '/home', 'old'), textRoute('2', '/about')], {
      onRefresh,
    });

    await routes.get('1');
    await routes.getByPath('/about');

    upstream.set('1', textRoute('1', '/home', 'new'));
    routes.refresh();

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    const [event] = onRefresh.mock.calls[0]!;

    expect(event.kind).toBe('on-demand');
    expect(new Set(event.ids)).toEqual(new Set(['1', '2']));
    expect(fetches).toHaveLength(3);
    expect(new Set(fetches[2]!.ids)).toEqual(new Set(['1', '2']));

    expect(await routes.get('1')).toEqual(mapped('1', '/home', 'new'));
    expect(await routes.getByPath('/home')).toEqual(mapped('1', '/home', 'new'));
    expect(await routes.getByPath('/about')).toEqual(mapped('2', '/about'));
    expect(fetches).toHaveLength(3);

    destroy();
  });

  test('refresh() of an empty cache fetches and reports nothing', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, fetches, destroy } = setup([textRoute('1', '/home')], { onRefresh });

    routes.refresh();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetches).toEqual([]);
    expect(onRefresh).not.toHaveBeenCalled();

    destroy();
  });

  test('refresh$ streams the refresh events', async () => {
    const { routes, destroy } = setup([textRoute('1', '/home')]);
    const events: RefreshEvent[] = [];

    await routes.get('1');

    const drained = (async () => {
      for await (const event of routes.refresh$) {
        events.push(event);
      }
    })();

    routes.refresh();

    await vi.waitFor(() => expect(events).toEqual([{ ids: ['1'], kind: 'on-demand' }]));

    destroy();

    await drained;
  });
});
