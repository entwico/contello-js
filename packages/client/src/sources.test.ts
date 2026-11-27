import { describe, expect, expectTypeOf, test } from 'vitest';

import type { OperationOptions } from './deadline';
import { type SourceTransport, createSources } from './sources';
import type { SourceAccessors, SourceCardinality, SourceDef, SourceMap } from './types';

type AnySubscribe = (
  query: string,
  variables: Record<string, unknown> | undefined,
  options: OperationOptions | undefined,
) => AsyncIterable<unknown>;

// what the client answers with on a connection that stays up: every message, or the first one
function collectOf(subscribe: AnySubscribe): SourceTransport['readAll'] {
  return ((query, variables, options) => Array.fromAsync(subscribe(query, variables, options))) as SourceTransport['readAll'];
}

function firstOf(subscribe: AnySubscribe): SourceTransport['write'] {
  return (async (query, variables, options) => {
    const messages = await Array.fromAsync(subscribe(query, variables, options));

    return messages[0];
  }) as SourceTransport['write'];
}

function unusedTransport(): never {
  throw new Error('not the transport of this operation');
}

function sourcesOf<TSources extends SourceMap>(sources: TSources, subscribe: unknown): SourceAccessors<TSources> {
  return createSources(sources, {
    write: firstOf(subscribe as AnySubscribe),
    readOne: firstOf(subscribe as AnySubscribe),
    readAll: collectOf(subscribe as AnySubscribe),
  });
}

function batchedSubscribe<T>(batches: T[][]): AnySubscribe {
  return () =>
    (async function* () {
      for (const batch of batches) {
        yield { source: batch };
      }
    })();
}

function valueSubscribe<T>(value: T): AnySubscribe {
  return () =>
    (async function* () {
      yield { source: value };
    })();
}

const minimalSource = <C extends SourceCardinality>(__cardinality: C): SourceDef<string, C, unknown> =>
  ({
    document: `fragment X on XEntity { id }`,
    fragment: 'X',
    subscription: 'xBatch',
    __model: 'x',
    __cardinality,
  }) as SourceDef<string, C, unknown>;

describe('createSources entity-cardinality fetch', () => {
  test('concatenates every batch the server emits (not just the first)', async () => {
    const sources = { x: minimalSource('entity') };
    const accessors = sourcesOf(sources, batchedSubscribe([[1, 2, 3], [4, 5], [6]]));

    const result = await accessors.x.fetch();

    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('returns the single batch as-is when the server emits one chunk', async () => {
    const sources = { x: minimalSource('entity') };
    const accessors = sourcesOf(sources, batchedSubscribe([[1, 2, 3]]));

    expect(await accessors.x.fetch()).toEqual([1, 2, 3]);
  });

  test('returns an empty array when the server emits no batches', async () => {
    const sources = { x: minimalSource('entity') };
    const accessors = sourcesOf(sources, batchedSubscribe<number>([]));

    expect(await accessors.x.fetch()).toEqual([]);
  });
});

describe('createSources route/asset-cardinality fetch', () => {
  test('route source concatenates every batch', async () => {
    const sources = { r: minimalSource('route') };
    const accessors = sourcesOf(sources, batchedSubscribe([['a'], ['b', 'c']]));

    expect(await accessors.r.fetch()).toEqual(['a', 'b', 'c']);
  });

  test('asset source concatenates every batch', async () => {
    const sources = { a: minimalSource('asset') };
    const accessors = sourcesOf(sources, batchedSubscribe([[1], [2], [3]]));

    expect(await accessors.a.fetch()).toEqual([1, 2, 3]);
  });
});

describe('createSources i18nMessage-cardinality fetch', () => {
  test('concatenates every batch and threads the collection variable through', async () => {
    const sources = { i: minimalSource('i18nMessage') };
    let receivedVars: Record<string, unknown> | undefined;
    const subscribe: AnySubscribe = (_doc, vars) => {
      receivedVars = vars;

      return (async function* () {
        yield { source: ['a', 'b'] };
        yield { source: ['c'] };
      })();
    };
    const accessors = sourcesOf(sources, subscribe);

    expect(await accessors.i.fetch({ collection: 'errors' })).toEqual(['a', 'b', 'c']);
    expect(receivedVars).toEqual({ collection: 'errors' });
  });
});

describe('createSources singleton-cardinality fetch', () => {
  test('returns the first yielded value (single value semantics)', async () => {
    const sources = { s: minimalSource('singleton') };
    const accessors = sourcesOf(sources, valueSubscribe({ id: '42', name: 'config' }));

    expect(await accessors.s.fetch()).toEqual({ id: '42', name: 'config' });
  });
});

describe('createSources write accessors', () => {
  const writableSource: SourceDef<string, 'entity', unknown> = {
    document: 'fragment X on XEntity { id name }',
    fragment: 'X',
    subscription: 'xBatch',
    mutations: {
      create: {
        field: 'createX',
        arguments: [{ name: 'request', type: 'CreateXRequestInput!', from: 'input', envelope: 'entity' }],
        result: 'entity',
      },
      delete: {
        field: 'deleteX',
        arguments: [{ name: 'request', type: 'DeleteEntityByIdInput!', from: 'input' }],
        result: 'idObject',
      },
    },
    __model: 'x',
    __cardinality: 'entity',
  };

  function resultSubscribe(result: unknown): AnySubscribe {
    return () =>
      (async function* () {
        yield { result };
      })();
  }

  test('a create answers with the entity in the source fragment shape, not with its id', async () => {
    const entity = { id: '1', name: 'shoes' };
    const accessors = sourcesOf({ x: writableSource }, resultSubscribe(entity));

    expect(await (accessors.x as any).create({ attributes: { name: 'shoes' } })).toEqual(entity);
  });

  test('a delete answers with the id it removed', async () => {
    const accessors = sourcesOf({ x: writableSource }, resultSubscribe({ id: '1' }));

    expect(await (accessors.x as any).delete({ id: '1' })).toBe('1');
  });

  test('carries no writer for a kind the source binds no mutation for', () => {
    const accessors = sourcesOf({ x: writableSource }, resultSubscribe({}));

    expect(Object.keys(accessors.x)).toEqual(['fetch', 'create', 'delete']);
  });

  test('writes through the transport that is not sent again', async () => {
    const accessors = createSources({ x: writableSource }, {
      write: firstOf(resultSubscribe({ id: '1' })),
      readOne: unusedTransport,
      readAll: unusedTransport,
    });

    await expect((accessors.x as any).create({ attributes: { name: 'new' } })).resolves.toEqual({ id: '1' });
  });
});

describe('createSources transport', () => {
  test('reads a singleton through the transport that is sent again', async () => {
    const accessors = createSources({ x: minimalSource('singleton') }, {
      write: unusedTransport,
      readOne: firstOf(valueSubscribe({ id: '1' })),
      readAll: unusedTransport,
    });

    await expect(accessors.x.fetch()).resolves.toEqual({ id: '1' });
  });

  test('reads a list through the transport that starts over', async () => {
    const accessors = createSources({ x: minimalSource('entity') }, {
      write: unusedTransport,
      readOne: unusedTransport,
      readAll: collectOf(batchedSubscribe([[1], [2]])),
    });

    await expect(accessors.x.fetch()).resolves.toEqual([1, 2]);
  });
});

describe('createSources batch writes', () => {
  const requests = (type: string) => ({ name: 'requests', type, from: 'input', each: true, envelope: 'entity' }) as const;

  const batchSource: SourceDef<string, 'entity', unknown> = {
    document: 'fragment X on XEntity { id name }',
    fragment: 'X',
    subscription: 'xBatch',
    mutations: {
      createMany: { field: 'createXs', arguments: [requests('[CreateXRequestInput!]')], result: 'entity' },
      updateMany: { field: 'updateXs', arguments: [requests('[UpdateXRequestInput!]')], result: 'entity' },
      deleteMany: {
        field: 'deleteXs',
        arguments: [{ name: 'request', type: 'DeleteEntitiesByIdsInput!', from: 'input' }],
        result: 'idObject',
      },
    },
    __model: 'x',
    __cardinality: 'entity',
  };

  function recordingWrite(result: unknown) {
    const calls: { query: string; variables: unknown; options: unknown }[] = [];

    const accessors = createSources({ x: batchSource }, {
      write: ((query: string, variables: unknown, options: unknown) => {
        calls.push({ query, variables, options });

        return Promise.resolve({ result });
      }) as SourceTransport['write'],
      readOne: unusedTransport,
      readAll: unusedTransport,
    }).x as any;

    return { accessors, calls };
  }

  test('an updateMany sends every input in its own envelope, in one mutation', async () => {
    const { accessors, calls } = recordingWrite([{ id: 'a' }, { id: 'b' }]);

    await accessors.updateMany([
      { id: 'a', attributes: { name: 'first' } },
      { id: 'b', attributes: { name: 'second' } },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain(
      'mutation($requests: [UpdateXRequestInput!]) { result: updateXs(requests: $requests) { ...X } }',
    );
    expect(calls[0]!.variables).toEqual({
      requests: [
        { entity: { id: 'a', attributes: { name: 'first' } } },
        { entity: { id: 'b', attributes: { name: 'second' } } },
      ],
    });
  });

  test('an updateMany encodes its inputs the way an update does', async () => {
    const { accessors, calls } = recordingWrite([{ id: 'a' }]);
    const checkedAt = { year: 2026, month: 5, day: 26, hour: 8, minute: 30, second: 0 };

    await accessors.updateMany([{ id: 'a', attributes: { offers: [{ checkedAt }] } }]);

    const [request] = (calls[0]!.variables as { requests: any[] }).requests;

    expect(request.entity.attributes.offers[0].checkedAt).toBe('2026-05-26T08:30:00Z');
  });

  test('an updateMany answers in the order of its inputs, whatever order the server answers in', async () => {
    const { accessors } = recordingWrite([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);

    await expect(accessors.updateMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).resolves.toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });

  test('a createMany whose inputs carry no ids answers in the order of the server', async () => {
    const { accessors } = recordingWrite([{ id: 'b' }, { id: 'a' }]);

    await expect(
      accessors.createMany([{ attributes: { name: 'first' } }, { attributes: { name: 'second' } }]),
    ).resolves.toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  test('a deleteMany sends its request as it is and answers with the ids it removed', async () => {
    const { accessors, calls } = recordingWrite([{ id: 'a' }, { id: 'b' }]);

    await expect(accessors.deleteMany({ ids: ['a', 'b'], force: true })).resolves.toEqual(['a', 'b']);
    expect(calls[0]!.variables).toEqual({ request: { ids: ['a', 'b'], force: true } });
  });

  test('a batch write of nothing does not ask the server', async () => {
    const { accessors, calls } = recordingWrite([]);

    await expect(accessors.updateMany([])).resolves.toEqual([]);
    await expect(accessors.createMany([])).resolves.toEqual([]);
    await expect(accessors.deleteMany({ ids: [] })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('a failed batch write rejects as a whole', async () => {
    const accessors = createSources({ x: batchSource }, {
      write: () => Promise.reject(new Error('one entity was refused')),
      readOne: unusedTransport,
      readAll: unusedTransport,
    }).x as any;

    await expect(accessors.updateMany([{ id: 'a' }, { id: 'b' }])).rejects.toThrow('one entity was refused');
  });
});

describe('createSources options', () => {
  test('passes the signal of a read and of a write on to the transport', async () => {
    const seen: unknown[] = [];
    const { signal } = new AbortController();

    const record = (answer: unknown) =>
      ((_query: string, _variables: unknown, options: unknown) => {
        seen.push(options);

        return Promise.resolve(answer);
      }) as never;

    const sources = {
      list: minimalSource('entity'),
      one: minimalSource('singleton'),
      written: {
        ...minimalSource('entity'),
        mutations: {
          update: { field: 'updateX', arguments: [{ name: 'request', type: 'X!', from: 'input' }], result: 'entity' },
        },
      } as SourceDef<string, 'entity', unknown>,
    };

    const accessors = createSources(sources, {
      write: record({ result: { id: '1' } }),
      readOne: record({ source: { id: '1' } }),
      readAll: record([{ source: [] }]),
    }) as any;

    await accessors.list.fetch({ ids: ['1'], signal });
    await accessors.one.fetch({ signal });
    await accessors.written.update({ id: '1' }, { signal });

    expect(seen).toEqual([{ signal }, { signal }, { signal }]);
  });

  test('keeps the signal of a list read out of its variables', async () => {
    let variables: unknown;

    const accessors = createSources({ list: minimalSource('entity') }, {
      write: unusedTransport,
      readOne: unusedTransport,
      readAll: ((_query: string, vars: unknown) => {
        variables = vars;

        return Promise.resolve([]);
      }) as never,
    });

    await accessors.list.fetch({ ids: ['1'], signal: new AbortController().signal });

    expect(variables).toEqual({ ids: ['1'] });
  });
});

describe('SourceAccessors types', () => {
  type Thing = { id: string; name: string };
  type Update = { id: string; attributes: { name: string } };

  type Sources = {
    thing: SourceDef<'thing', 'entity', Thing, { update: Update; updateMany: Update; deleteMany: { ids: string[] } }>;
    config: SourceDef<'config', 'singleton', Thing, { update: Update }>;
  };

  test('a source has the batch writes its model has a mutation for, and no others', () => {
    type Accessors = SourceAccessors<Sources>;

    expectTypeOf<Accessors['thing']['updateMany']>().toEqualTypeOf<
      (inputs: readonly Update[], options?: OperationOptions | undefined) => Promise<Thing[]>
    >();
    expectTypeOf<Accessors['thing']['deleteMany']>().returns.toEqualTypeOf<Promise<string[]>>();
    expectTypeOf<Accessors['thing']>().not.toHaveProperty('createMany');
    expectTypeOf<Accessors['config']>().not.toHaveProperty('updateMany');
  });

  test('a read takes a signal: a list next to its filter, a singleton on its own', () => {
    type Accessors = SourceAccessors<Sources>;
    const { signal } = new AbortController();

    expectTypeOf<Accessors['thing']['fetch']>().toBeCallableWith({ ids: ['1'], signal });
    expectTypeOf<Accessors['thing']['fetch']>().toBeCallableWith();
    expectTypeOf<Accessors['config']['fetch']>().toBeCallableWith({ signal });
  });
});
