import { describe, expect, test } from 'vitest';

import { createSources } from './sources';
import type { SourceCardinality, SourceDef } from './types';

type AnySubscribe = (query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<unknown>;

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
    const accessors = createSources(sources, batchedSubscribe([[1, 2, 3], [4, 5], [6]]) as never);

    const result = await accessors.x.fetch();

    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('returns the single batch as-is when the server emits one chunk', async () => {
    const sources = { x: minimalSource('entity') };
    const accessors = createSources(sources, batchedSubscribe([[1, 2, 3]]) as never);

    expect(await accessors.x.fetch()).toEqual([1, 2, 3]);
  });

  test('returns an empty array when the server emits no batches', async () => {
    const sources = { x: minimalSource('entity') };
    const accessors = createSources(sources, batchedSubscribe<number>([]) as never);

    expect(await accessors.x.fetch()).toEqual([]);
  });
});

describe('createSources route/asset-cardinality fetch', () => {
  test('route source concatenates every batch', async () => {
    const sources = { r: minimalSource('route') };
    const accessors = createSources(sources, batchedSubscribe([['a'], ['b', 'c']]) as never);

    expect(await accessors.r.fetch()).toEqual(['a', 'b', 'c']);
  });

  test('asset source concatenates every batch', async () => {
    const sources = { a: minimalSource('asset') };
    const accessors = createSources(sources, batchedSubscribe([[1], [2], [3]]) as never);

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
    const accessors = createSources(sources, subscribe as never);

    expect(await accessors.i.fetch({ collection: 'errors' })).toEqual(['a', 'b', 'c']);
    expect(receivedVars).toEqual({ collection: 'errors' });
  });
});

describe('createSources singleton-cardinality fetch', () => {
  test('returns the first yielded value (single value semantics)', async () => {
    const sources = { s: minimalSource('singleton') };
    const accessors = createSources(sources, valueSubscribe({ id: '42', name: 'config' }) as never);

    expect(await accessors.s.fetch()).toEqual({ id: '42', name: 'config' });
  });
});
