import type { ContelloClient } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { createAssetsCollection } from './assets';
import { ModelResolver } from './model-resolver';
import { createRoutesCollection } from './routes';
import type { StoreRoute } from './routes-mapping';
import type { CollectionWrites, RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type RouteWrites = { create: { path: string }; update: { path: string }; delete: { id: string } };
type AssetWrites = { update: { id: string; name?: string }; delete: { id: string } };

type RawRoute = {
  __typename: 'ContelloRoute';
  id: string;
  path: string;
  customHeaders: never[];
  target: { __typename: 'ContelloRouteTargetText'; content: string; mimeType: string };
};

type RawAsset = {
  __typename: 'ContelloAsset';
  id: string;
  name: string;
  annotations: never[];
  original: { uid: string; mimeType: string; metadata: null };
  optimized: never[];
};

function makeRoute(id: string, path: string): RawRoute {
  return {
    __typename: 'ContelloRoute',
    id,
    path,
    customHeaders: [],
    target: { __typename: 'ContelloRouteTargetText', content: id, mimeType: 'text/plain' },
  };
}

function makeAsset(id: string, name: string): RawAsset {
  return {
    __typename: 'ContelloAsset',
    id,
    name,
    annotations: [],
    original: { uid: name, mimeType: 'image/jpeg', metadata: null },
    optimized: [],
  };
}

/**
 * Stands in for the server: writes land in the same state the source subscription reads from, and
 * every mutation and fetch is recorded so a test can assert a write did not go back over the wire.
 */
function makeClient<T extends { id: string }>(
  initial: T[],
  mutate: (field: string, vars: any, state: Map<string, T>) => unknown,
) {
  const state = new Map(initial.map((item) => [item.id, item]));
  const mutations: { field: string; variables: Record<string, unknown> }[] = [];
  const fetched: (string[] | undefined)[] = [];

  const client = {
    subscribe<R>(_query: string, variables?: Record<string, unknown> | undefined): AsyncIterable<R> {
      const ids = variables?.['ids'] as string[] | undefined;

      fetched.push(ids);

      const items = ids ? ids.flatMap((id) => (state.has(id) ? [state.get(id)!] : [])) : state.values().toArray();

      return {
        async* [Symbol.asyncIterator]() {
          yield { source: items } as R;
        },
      };
    },

    async execute<R>(query: string, variables?: Record<string, unknown> | undefined): Promise<R> {
      const vars = variables ?? {};
      const field = /result: (\w+)\(/.exec(query)![1]!;

      mutations.push({ field, variables: vars });

      return { result: mutate(field, vars, state) } as R;
    },
  } as unknown as ContelloClient<any>;

  return { client, mutations, fetched, state };
}

function makeRoutes(onRefresh?: (event: RefreshEvent) => void) {
  let nextId = 0;
  const { client, mutations, fetched, state } = makeClient<RawRoute>(
    [makeRoute('r1', '/one'), makeRoute('r2', '/two')],
    (field, vars, routes) => {
      if (field === 'deleteContelloRoute') {
        routes.delete(vars['id']);

        return vars['id'];
      }

      const path = vars['route'].path as string;
      const existing = routes.values().find((r) => r.path === path);

      nextId += 1;

      const route = makeRoute(existing?.id ?? `new-${nextId}`, path);

      routes.set(route.id, route);

      return route;
    },
  );

  const { instance, destroy } = createRoutesCollection(
    onRefresh ? { onRefresh } : undefined,
    client,
    createAsyncIterableSubject<UpdateBatch>(),
    new ModelResolver(undefined),
    createRefreshByTtlQueue(),
  );

  return {
    routes: instance as typeof instance & CollectionWrites<StoreRoute, RouteWrites>,
    mutations,
    fetched,
    state,
    destroy,
  };
}

describe('route writes', () => {
  test('create runs the mutation and takes the route into both indexes without fetching', async () => {
    const { routes, mutations, fetched, destroy } = makeRoutes();

    await routes.load();
    fetched.length = 0;

    const created = await routes.create({ path: '/three' });

    expect(created.path).toBe('/three');
    expect(mutations).toEqual([{ field: 'createContelloRoute', variables: { route: { path: '/three' } } }]);
    expect(fetched).toEqual([]);
    expect(await routes.getByPath('/three')).toEqual(created);
    expect(await routes.get(created.id)).toEqual(created);

    destroy();
  });

  test('update is addressed by the path in its input, not by an id', async () => {
    const { routes, mutations, destroy } = makeRoutes();

    await routes.load();

    const updated = await routes.update({ path: '/two' });

    expect(updated.id).toBe('r2');
    expect(mutations[0]?.variables).toEqual({ route: { path: '/two' } });

    destroy();
  });

  test('delete passes a bare id and drops the route from both indexes', async () => {
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { routes, mutations, fetched, destroy } = makeRoutes(onRefresh);

    await routes.load();
    fetched.length = 0;

    await routes.delete('r1');

    expect(mutations[0]).toEqual({ field: 'deleteContelloRoute', variables: { id: 'r1' } });
    expect(fetched).toEqual([]);
    expect(await routes.get('r1')).toBeUndefined();
    expect(await routes.getByPath('/one')).toBeUndefined();
    expect(onRefresh).toHaveBeenCalledWith({ ids: ['r1'], kind: 'write' });

    destroy();
  });
});

describe('asset writes', () => {
  function makeAssets() {
    const { client, mutations, fetched } = makeClient<RawAsset>(
      [makeAsset('a1', 'one'), makeAsset('a2', 'two')],
      (field, vars, assets) => {
        if (field === 'deleteContelloAsset') {
          assets.delete(vars['id']);

          return { id: vars['id'] };
        }

        const { id, name } = vars['request'];
        const asset = makeAsset(id, name ?? assets.get(id)!.name);

        assets.set(id, asset);

        return asset;
      },
    );

    const { instance, destroy } = createAssetsCollection(
      undefined,
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      createRefreshByTtlQueue(),
    );

    return { assets: instance as typeof instance & CollectionWrites<any, AssetWrites>, mutations, fetched, destroy };
  }

  test('update patches the asset and takes it into the cache without fetching', async () => {
    const { assets, mutations, fetched, destroy } = makeAssets();

    await assets.load();
    fetched.length = 0;

    const updated = await assets.update({ id: 'a1', name: 'renamed' });

    // the store's asset shape carries files, not the name — the rename shows up on the mapped original
    expect(updated).toMatchObject({ id: 'a1', original: { uid: 'renamed' } });
    expect(mutations).toEqual([
      { field: 'updateContelloAsset', variables: { request: { id: 'a1', name: 'renamed' } } },
    ]);
    expect(fetched).toEqual([]);
    expect(await assets.get('a1')).toMatchObject({ original: { uid: 'renamed' } });

    destroy();
  });

  test('delete passes a bare id and evicts the asset', async () => {
    const { assets, mutations, destroy } = makeAssets();

    await assets.load();
    await assets.delete('a2');

    expect(mutations[0]).toEqual({ field: 'deleteContelloAsset', variables: { id: 'a2' } });
    expect(await assets.get('a2')).toBeUndefined();

    destroy();
  });

  test('assets have no create — an asset is uploaded, not mutated into being', () => {
    const { assets, destroy } = makeAssets();

    expect(assets).not.toHaveProperty('create');

    destroy();
  });
});
