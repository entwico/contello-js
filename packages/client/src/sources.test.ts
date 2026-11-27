import { describe, expect, test } from 'vitest';

import { createSources } from './sources';
import type { SourceAccessors, SourceCardinality, SourceDef, SourceMap } from './types';

type AnySubscribe = (query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<unknown>;

type AnyCollect = (query: string, variables?: Record<string, unknown> | undefined) => Promise<unknown[]>;

// what the client's collect() answers with on a connection that stays up
function collectOf(subscribe: AnySubscribe): AnyCollect {
  return async (query, variables) => {
    const messages: unknown[] = await Array.fromAsync(subscribe(query, variables));

    return messages;
  };
}

function unusedTransport(): never {
  throw new Error('not the transport of this operation');
}

function sourcesOf<TSources extends SourceMap>(sources: TSources, subscribe: unknown): SourceAccessors<TSources> {
  return createSources(sources, {
    write: subscribe as never,
    readOne: subscribe as never,
    readAll: collectOf(subscribe as AnySubscribe) as never,
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
      write: resultSubscribe({ id: '1' }) as never,
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
      readOne: valueSubscribe({ id: '1' }) as never,
      readAll: unusedTransport,
    });

    await expect(accessors.x.fetch()).resolves.toEqual({ id: '1' });
  });

  test('reads a list through the transport that starts over', async () => {
    const accessors = createSources({ x: minimalSource('entity') }, {
      write: unusedTransport,
      readOne: unusedTransport,
      readAll: collectOf(batchedSubscribe([[1], [2]])) as never,
    });

    await expect(accessors.x.fetch()).resolves.toEqual([1, 2]);
  });
});
