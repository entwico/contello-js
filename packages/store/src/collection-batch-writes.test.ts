import type { ContelloClient, SourceDef } from '@contello/client';
import { createFakeContelloClient } from '@contello/client/testing';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test, vi } from 'vitest';

import { createCollection } from './collection';
import { ModelResolver } from './model-resolver';
import type { Collection, RefreshEvent } from './types';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type Item = { id: string; value: number };
type CreateInput = { id?: string | undefined; attributes: { value: number } };
type UpdateInput = { id: string; attributes: { value: number } };
type Writes = {
  update: UpdateInput;
  delete: { id: string; force?: boolean | undefined };
  createMany: CreateInput;
  updateMany: UpdateInput;
  deleteMany: { ids: string[]; force?: boolean | undefined };
};

const requests = (type: string) => ({ name: 'requests', type, from: 'input', each: true, envelope: 'entity' }) as const;

const source: SourceDef<'thing', 'entity', Item, Writes> = {
  document: '',
  fragment: 'Thing',
  subscription: 'thingsBatch',
  mutations: {
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
    createMany: { field: 'createThings', arguments: [requests('[CreateThingRequestInput!]')], result: 'entity' },
    updateMany: { field: 'updateThings', arguments: [requests('[UpdateThingRequestInput!]')], result: 'entity' },
    deleteMany: {
      field: 'deleteThings',
      arguments: [{ name: 'request', type: 'DeleteEntitiesByIdsInput!', from: 'input' }],
      result: 'idObject',
    },
  },
  __model: 'thing',
  __cardinality: 'entity',
};

/**
 * Stands in for the server: mutations apply to the state the source subscription reads from. A
 * batch answers its entities in reverse, the server promises no order.
 */
function makeClient(initial: Item[], hold?: Promise<void> | undefined) {
  const state = new Map(initial.map((item) => [item.id, item]));
  const mutations: { field: string; variables: Record<string, any> }[] = [];
  const fetched: (string[] | undefined)[] = [];
  let nextId = 0;

  const write = (entity: CreateInput): Item => {
    nextId += 1;

    const item: Item = { id: entity.id ?? `new-${nextId}`, value: entity.attributes.value };

    state.set(item.id, item);

    return item;
  };

  const remove = (id: string): { id: string } => {
    state.delete(id);

    return { id };
  };

  const { client } = createFakeContelloClient({
    subscribe(_query, variables) {
      const ids = variables?.['ids'] as string[] | undefined;

      fetched.push(ids);

      return { source: ids ? ids.flatMap((id) => state.get(id) ?? []) : state.values().toArray() };
    },

    async execute(query, variables) {
      const vars = (variables ?? {}) as Record<string, any>;
      const field = /result: (\w+)\(/.exec(query)![1]!;

      await hold;
      mutations.push({ field, variables: vars });

      switch (field) {
        case 'createThings':
        case 'updateThings': {
          return { result: (vars['requests'] as { entity: CreateInput }[]).map(({ entity }) => write(entity)).toReversed() };
        }
        case 'deleteThings': {
          return { result: (vars['request'].ids as string[]).map((id) => remove(id)) };
        }
        case 'deleteThing': {
          return { result: remove(vars['request'].id) };
        }
        default: {
          return { result: write(vars['request'].entity) };
        }
      }
    },
  });

  return { client, mutations, fetched, state };
}

async function makeCollection(client: ContelloClient<any>, onRefresh?: ((event: RefreshEvent) => void) | undefined) {
  const { instance } = createCollection<typeof source, Item, string>(
    source,
    { onRefresh },
    client,
    createAsyncIterableSubject<UpdateBatch>(),
    new ModelResolver(undefined),
    createRefreshByTtlQueue(),
  );

  const collection = instance as Collection<Item, Writes>;

  await collection.load();

  return collection;
}

const things = [
  { id: 'a', value: 1 },
  { id: 'b', value: 2 },
  { id: 'c', value: 3 },
];

describe('collection batch writes', () => {
  test('updateMany writes all entities in one mutation and answers them in the order of its inputs', async () => {
    const { client, mutations } = makeClient(things);
    const collection = await makeCollection(client);

    const updated = await collection.updateMany([
      { id: 'a', attributes: { value: 10 } },
      { id: 'c', attributes: { value: 30 } },
    ]);

    expect(updated).toEqual([{ id: 'a', value: 10 }, { id: 'c', value: 30 }]);
    expect(mutations.map((mutation) => mutation.field)).toEqual(['updateThings']);
    expect(mutations[0]!.variables['requests']).toEqual([
      { entity: { id: 'a', attributes: { value: 10 } } },
      { entity: { id: 'c', attributes: { value: 30 } } },
    ]);
  });

  test('updateMany takes the written entities into the cache without going back over the wire', async () => {
    const { client, fetched } = makeClient(things);
    const onRefresh = vi.fn();
    const collection = await makeCollection(client, onRefresh);

    await collection.updateMany([
      { id: 'a', attributes: { value: 10 } },
      { id: 'b', attributes: { value: 20 } },
    ]);

    expect(fetched).toEqual([undefined]);
    expect(await collection.get(['a', 'b', 'c'])).toEqual([
      { id: 'a', value: 10 },
      { id: 'b', value: 20 },
      { id: 'c', value: 3 },
    ]);
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith({ ids: ['a', 'b'], kind: 'write' });
  });

  test('createMany answers with the created entities and holds them', async () => {
    const { client } = makeClient(things);
    const collection = await makeCollection(client);

    const created = await collection.createMany([
      { id: 'x', attributes: { value: 7 } },
      { id: 'y', attributes: { value: 8 } },
    ]);

    expect(created).toEqual([{ id: 'x', value: 7 }, { id: 'y', value: 8 }]);
    expect(await collection.get('y')).toEqual({ id: 'y', value: 8 });
  });

  test('deleteMany drops the entities locally and passes the rest of its options to the server', async () => {
    const { client, mutations, fetched } = makeClient(things);
    const onRefresh = vi.fn();
    const collection = await makeCollection(client, onRefresh);

    await collection.deleteMany(['a', 'b'], { force: true });

    expect(mutations[0]!.variables).toEqual({ request: { ids: ['a', 'b'], force: true } });
    expect(await collection.getAll()).toEqual([{ id: 'c', value: 3 }]);
    expect(fetched).toEqual([undefined]);
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith({ ids: ['a', 'b'], kind: 'write' });
  });

  test('a batch write of nothing does not ask the server', async () => {
    const { client, mutations } = makeClient(things);
    const collection = await makeCollection(client);

    await expect(collection.updateMany([])).resolves.toEqual([]);
    await expect(collection.createMany([])).resolves.toEqual([]);
    await collection.deleteMany([]);

    expect(mutations).toHaveLength(0);
  });

  test('a failed batch write rejects as a whole and leaves the cache as it was', async () => {
    const { client } = createFakeContelloClient({
      subscribe: () => ({ source: things }),
      execute: () => Promise.reject(new Error('one entity was refused')),
    });
    const collection = await makeCollection(client);

    await expect(collection.updateMany([{ id: 'a', attributes: { value: 10 } }])).rejects.toThrow('refused');
    expect(await collection.get('a')).toEqual({ id: 'a', value: 1 });
  });
});

describe('collection writes with a signal', () => {
  test('a write that is aborted rejects with the reason of the signal and leaves the cache as it was', async () => {
    const { promise: hold, resolve: release } = Promise.withResolvers<void>();
    const { client } = makeClient(things, hold);
    const collection = await makeCollection(client);
    const controller = new AbortController();

    const write = collection.updateMany([{ id: 'a', attributes: { value: 10 } }], { signal: controller.signal });

    controller.abort(new Error('the import was stopped'));

    await expect(write).rejects.toThrow('the import was stopped');
    expect(await collection.get('a')).toEqual({ id: 'a', value: 1 });

    release();
  });

  test('the signal of a delete is not sent to the server with the rest of its options', async () => {
    const { client, mutations } = makeClient(things);
    const collection = await makeCollection(client);
    const { signal } = new AbortController();

    await collection.delete('a', { force: true, signal });
    await collection.deleteMany(['b'], { signal });

    expect(mutations.map((mutation) => mutation.variables)).toEqual([
      { request: { force: true, id: 'a' } },
      { request: { ids: ['b'] } },
    ]);
  });
});
