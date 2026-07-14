import { describe, expect, test, vi } from 'vitest';

import { buildRpc } from './rpc';
import type { OperationDef, OperationMap } from './types';

function op(kind: OperationDef['kind'], document: string): OperationDef {
  return { document, kind };
}

async function* toAsync<T>(values: T[]): AsyncIterable<T> {
  for (const value of values) {
    yield value;
  }
}

describe('buildRpc', () => {
  test('query methods resolve to the first emitted value', async () => {
    const operations = { getUser: op('query', 'query GetUser { user { id } }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ user: { id: '1' } }]));

    const rpc = buildRpc(operations, subscribe as any);
    const result = await (rpc.getUser as () => Promise<unknown>)();

    expect(result).toEqual({ user: { id: '1' } });
    expect(subscribe).toHaveBeenCalledWith('query GetUser { user { id } }', undefined);
  });

  test('mutation methods resolve to the first emitted value', async () => {
    const operations = { doThing: op('mutation', 'mutation DoThing { thing }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ thing: true }]));

    const rpc = buildRpc(operations, subscribe as any);
    const result = await (rpc.doThing as () => Promise<unknown>)();

    expect(result).toEqual({ thing: true });
  });

  test('subscription methods return the async iterable directly', async () => {
    const operations = { watch: op('subscription', 'subscription Watch { tick }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ tick: 1 }, { tick: 2 }]));

    const rpc = buildRpc(operations, subscribe as any);
    const iterable = (rpc.watch as unknown as () => AsyncIterable<unknown>)();
    const received = await Array.fromAsync(iterable);

    expect(received).toEqual([{ tick: 1 }, { tick: 2 }]);
  });

  test('encodes managed scalar variables before dispatching', async () => {
    const operations = { getUser: op('query', 'query GetUser { user { id } }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ user: { id: '1' } }]));

    const rpc = buildRpc(operations, subscribe as any);

    await (rpc.getUser as (vars: unknown) => Promise<unknown>)({
      day: { year: 2026, month: 5, day: 26 },
    });

    expect(subscribe).toHaveBeenCalledWith('query GetUser { user { id } }', { day: '2026-05-26T00:00:00Z' });
  });

  test('passes transformed variables through for subscriptions too', async () => {
    const operations = { watch: op('subscription', 'subscription Watch { tick }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ tick: 1 }]));

    const rpc = buildRpc(operations, subscribe as any);
    const iterable = (rpc.watch as unknown as (vars: unknown) => AsyncIterable<unknown>)({ ids: ['a'] });

    for await (const _ of iterable) {
      break;
    }

    expect(subscribe).toHaveBeenCalledWith('subscription Watch { tick }', { ids: ['a'] });
  });

  test('builds a method for every operation in the map', () => {
    const operations = {
      a: op('query', 'query A { a }'),
      b: op('mutation', 'mutation B { b }'),
      c: op('subscription', 'subscription C { c }'),
    } satisfies OperationMap;

    const rpc = buildRpc(operations, (() => toAsync([])) as any);

    expect(Object.keys(rpc)).toEqual(['a', 'b', 'c']);
    expect(typeof (rpc as Record<string, unknown>)['a']).toBe('function');
  });
});
