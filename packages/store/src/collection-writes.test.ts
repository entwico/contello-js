import type { ContelloClient, SourceDef } from '@contello/client';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { createCollection } from './collection';
import { ModelResolver } from './model-resolver';
import type { Collection, RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type Item = { id: string; value: number };
type Writes = {
  create: { attributes: { value: number } };
  update: { id: string; attributes: { value: number } };
  delete: { id: string; force?: boolean | undefined };
};

const source: SourceDef<'thing', 'entity', Item, Writes> = {
  document: '',
  fragment: 'Thing',
  subscription: 'things',
  mutations: {
    create: {
      field: 'createThing',
      arguments: [{ name: 'request', type: 'CreateThingRequestInput!', from: 'input', envelope: 'entity' }],
      result: 'entity',
    },
    update: {
      field: 'updateThing',
      arguments: [{ name: 'request', type: 'UpdateThingRequestInput!', from: 'input', envelope: 'entity' }],
      result: 'entity',
    },
    delete: {
      field: 'deleteThing',
      arguments: [{ name: 'request', type: 'DeleteEntityByIdInput!', from: 'input' }],
      result: 'idObject',
    },
  },
  __model: 'thing',
  __cardinality: 'entity',
};

const readOnlySource: SourceDef<'thing', 'entity', Item> = {
  document: '',
  fragment: 'Thing',
  subscription: 'things',
  __model: 'thing',
  __cardinality: 'entity',
};

/**
 * Stands in for the server: mutations apply to the same state the source subscription reads
 * from, so a write followed by a read-back behaves the way the real round trip does.
 */
type ClientOptions = {
  /** holds a fetch open, so a refresh can be observed while it is still in flight */
  holdFetch?: ((ids: string[] | undefined) => Promise<void> | undefined) | undefined;
};

function makeClient(initial: Item[], options?: ClientOptions) {
  const state = new Map(initial.map((item) => [item.id, item]));
  const mutations: { field: string; variables: Record<string, unknown> }[] = [];
  const fetched: (string[] | undefined)[] = [];
  let nextId = 0;

  function applyMutation(query: string, variables: Record<string, unknown>): Item | { id: string } {
    const input = (variables['request'] as Record<string, any>) ?? {};

    if (query.includes('createThing')) {
      nextId += 1;

      const item: Item = { id: `new-${nextId}`, value: input['entity'].attributes.value };

      state.set(item.id, item);

      return item;
    }

    if (query.includes('updateThing')) {
      const item: Item = { id: input['entity'].id, value: input['entity'].attributes.value };

      state.set(item.id, item);

      return item;
    }

    const id = input['id'] as string;

    state.delete(id);

    return { id };
  }

  const client = {
    subscribe<T>(_query: string, variables?: Record<string, unknown> | undefined): AsyncIterable<T> {
      const ids = variables?.['ids'] as string[] | undefined;

      fetched.push(ids);

      return {
        async* [Symbol.asyncIterator]() {
          await options?.holdFetch?.(ids);

          const items = ids
            ? ids.flatMap((id) => (state.has(id) ? [state.get(id)!] : []))
            : state.values().toArray();

          yield { source: items } as T;
        },
      };
    },

    async execute<T>(query: string, variables?: Record<string, unknown> | undefined): Promise<T> {
      const vars = variables ?? {};
      const field = /result: (\w+)\(/.exec(query)![1]!;

      mutations.push({ field, variables: vars });

      return { result: applyMutation(query, vars) } as T;
    },
  } as unknown as ContelloClient<any>;

  return { client, mutations, fetched, state };
}

function makeCollection(
  client: ContelloClient<any>,
  options?: Parameters<typeof createCollection<typeof source, Item, string>>[1],
) {
  const updates$ = createAsyncIterableSubject<UpdateBatch>();
  const { instance, destroy } = createCollection<typeof source, Item, string>(
    source,
    options,
    client,
    updates$,
    new ModelResolver(undefined),
    createRefreshByTtlQueue(),
  );

  return { collection: instance as Collection<Item, Writes>, updates$, destroy };
}

function entityUpdate(id: string): UpdateBatch {
  return {
    entity: new Map([['thing', [{ id, mutation: 'update' }]]]),
    events: [],
    route: [],
    asset: [],
    i18nMessage: [],
    routeByEntityModel: new Map(),
  } as unknown as UpdateBatch;
}

describe('collection writes', () => {
  test('create runs the mutation and answers with the entity the mutation returned', async () => {
    const { client, mutations, fetched } = makeClient([{ id: 'a', value: 1 }]);
    const { collection, destroy } = makeCollection(client);

    await collection.load();
    fetched.length = 0;

    const created = await collection.create({ attributes: { value: 7 } });

    expect(created).toEqual({ id: 'new-1', value: 7 });
    expect(fetched).toEqual([]);
    expect(mutations).toEqual([
      { field: 'createThing', variables: { request: { entity: { attributes: { value: 7 } } } } },
    ]);
    expect(await collection.get('new-1')).toEqual({ id: 'new-1', value: 7 });

    destroy();
  });

  test('create emits a refresh event marked as a write', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { collection, destroy } = makeCollection(client, { onRefresh });

    await collection.load();
    await collection.create({ attributes: { value: 7 } });

    expect(onRefresh).toHaveBeenCalledWith({ ids: ['new-1'], kind: 'write' });

    destroy();
  });

  test('update takes the written entity into the cache without going back over the wire', async () => {
    const { client, fetched } = makeClient([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
    const { collection, destroy } = makeCollection(client);

    await collection.load();
    fetched.length = 0;

    const updated = await collection.update({ id: 'b', attributes: { value: 9 } });

    expect(updated).toEqual({ id: 'b', value: 9 });
    expect(fetched).toEqual([]);
    expect(await collection.get('b')).toEqual({ id: 'b', value: 9 });
    expect(await collection.get('a')).toEqual({ id: 'a', value: 1 });

    destroy();
  });

  test('the mapper runs on the written entity, like on any other read', async () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const { instance, destroy } = createCollection<typeof source, { id: string; doubled: number }, string>(
      source,
      { map: (item) => ({ id: item.id, doubled: item.value * 2 }) },
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );
    const collection = instance as Collection<{ id: string; doubled: number }, Writes>;

    await collection.load();

    expect(await collection.create({ attributes: { value: 7 } })).toEqual({ id: 'new-1', doubled: 14 });

    destroy();
  });

  test('delete drops the entity locally without fetching', async () => {
    const { client, fetched, mutations } = makeClient([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
    const onRefresh = vi.fn<(event: RefreshEvent) => void>();
    const { collection, destroy } = makeCollection(client, { onRefresh });

    await collection.load();
    fetched.length = 0;

    await collection.delete('a');

    expect(mutations[0]).toEqual({ field: 'deleteThing', variables: { request: { id: 'a' } } });
    expect(fetched).toEqual([]);
    expect(collection.getAll()).toEqual([{ id: 'b', value: 2 }]);
    expect(onRefresh).toHaveBeenCalledWith({ ids: ['a'], kind: 'write' });

    destroy();
  });

  test('delete passes the remaining input alongside the id', async () => {
    const { client, mutations } = makeClient([{ id: 'a', value: 1 }]);
    const { collection, destroy } = makeCollection(client);

    await collection.load();
    await collection.delete('a', { force: true });

    expect(mutations[0]?.variables).toEqual({ request: { force: true, id: 'a' } });

    destroy();
  });

  test('a write on a collection that was never loaded falls back to loading it', async () => {
    const { client, fetched } = makeClient([{ id: 'a', value: 1 }]);
    const { collection, destroy } = makeCollection(client);

    const created = await collection.create({ attributes: { value: 7 } });

    expect(created).toEqual({ id: 'new-1', value: 7 });
    expect(fetched).toEqual([undefined]);
    expect(await collection.getAll()).toEqual([
      { id: 'a', value: 1 },
      { id: 'new-1', value: 7 },
    ]);

    destroy();
  });

  test('the written entity is served once — the watcher event for it still refetches', async () => {
    const { client, fetched } = makeClient([{ id: 'a', value: 1 }]);
    const { collection, updates$, destroy } = makeCollection(client);

    await collection.load();
    await collection.create({ attributes: { value: 7 } });
    fetched.length = 0;

    updates$.next(entityUpdate('new-1'));

    await vi.waitFor(() => expect(fetched).toEqual([['new-1']]));

    destroy();
  });

  test('a write does not answer an upstream refresh that was already outstanding for the same id', async () => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    let heldOnce = false;
    const { client, fetched, mutations, state } = makeClient([{ id: 'b', value: 2 }], {
      holdFetch: (ids) => {
        if (heldOnce || !ids?.includes('b')) {
          return;
        }

        heldOnce = true;

        return held;
      },
    });
    const { collection, updates$, destroy } = makeCollection(client);

    await collection.load();
    fetched.length = 0;

    // another client edited "b"; its refetch is in flight when our own write lands
    updates$.next(entityUpdate('b'));
    await vi.waitFor(() => expect(fetched).toEqual([['b']]));

    const writing = collection.update({ id: 'b', attributes: { value: 9 } });

    await vi.waitFor(() => expect(mutations).toHaveLength(1));
    // the other client's edit is what the server ends up holding
    state.set('b', { id: 'b', value: 42 });
    release();

    expect(await writing).toEqual({ id: 'b', value: 42 });
    expect(await collection.get('b')).toEqual({ id: 'b', value: 42 });

    destroy();
  });

  test('a source with no mutations has no write methods at all', () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const { instance, destroy } = createCollection<typeof readOnlySource, Item, string>(
      readOnlySource,
      undefined,
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    expect(instance).not.toHaveProperty('create');
    expect(instance).not.toHaveProperty('update');
    expect(instance).not.toHaveProperty('delete');

    destroy();
  });

  test('a source binding only some mutations gets only those methods', () => {
    const { client } = makeClient([{ id: 'a', value: 1 }]);
    const partialSource: SourceDef<'thing', 'entity', Item, Pick<Writes, 'create'>> = {
      ...source,
      mutations: { create: source.mutations!.create },
    };
    const { instance, destroy } = createCollection<typeof partialSource, Item, string>(
      partialSource,
      undefined,
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      new ModelResolver(undefined),
      createRefreshByTtlQueue(),
    );

    expect(instance).toHaveProperty('create');
    expect(instance).not.toHaveProperty('update');
    expect(instance).not.toHaveProperty('delete');
    // @ts-expect-error — the source binds no delete mutation, so the collection carries none
    expect(instance.delete).toBeUndefined();

    destroy();
  });
});
