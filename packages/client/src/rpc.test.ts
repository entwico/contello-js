import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import type { OperationOptions } from './deadline';
import { type RpcTransport, buildRpc } from './rpc';
import type { OperationDef, OperationMap, Rpc } from './types';

function op(kind: OperationDef['kind'], document: string): OperationDef {
  return { document, kind };
}

async function* toAsync<T>(values: T[]): AsyncIterable<T> {
  for (const value of values) {
    yield value;
  }
}

function transportOf(subscribe: any, subscribeWithRetry: any = subscribe): RpcTransport {
  return {
    subscribe,
    subscribeWithRetry,
    first: (async (query: string, variables: unknown, options: unknown) => {
      const messages = await Array.fromAsync(subscribe(query, variables, options));

      return messages[0];
    }) as RpcTransport['first'],
  };
}

describe('buildRpc', () => {
  test('query methods resolve to the first emitted value', async () => {
    const operations = { getUser: op('query', 'query GetUser { user { id } }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ user: { id: '1' } }]));

    const rpc = buildRpc(operations, transportOf(subscribe as any));
    const result = await (rpc.getUser as () => Promise<unknown>)();

    expect(result).toEqual({ user: { id: '1' } });
    expect(subscribe).toHaveBeenCalledWith('query GetUser { user { id } }', undefined, undefined);
  });

  test('mutation methods resolve to the first emitted value', async () => {
    const operations = { doThing: op('mutation', 'mutation DoThing { thing }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ thing: true }]));

    const rpc = buildRpc(operations, transportOf(subscribe as any));
    const result = await (rpc.doThing as () => Promise<unknown>)();

    expect(result).toEqual({ thing: true });
  });

  test('subscription methods return the async iterable directly', async () => {
    const operations = { watch: op('subscription', 'subscription Watch { tick }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ tick: 1 }, { tick: 2 }]));

    const rpc = buildRpc(operations, transportOf(subscribe as any));
    const iterable = (rpc.watch as unknown as () => AsyncIterable<unknown>)();
    const received = await Array.fromAsync(iterable);

    expect(received).toEqual([{ tick: 1 }, { tick: 2 }]);
  });

  test('encodes managed scalar variables before dispatching', async () => {
    const operations = { getUser: op('query', 'query GetUser { user { id } }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ user: { id: '1' } }]));

    const rpc = buildRpc(operations, transportOf(subscribe as any));

    await (rpc.getUser as (vars: unknown) => Promise<unknown>)({
      day: { year: 2026, month: 5, day: 26 },
    });

    expect(subscribe).toHaveBeenCalledWith('query GetUser { user { id } }', { day: '2026-05-26T00:00:00Z' }, undefined);
  });

  test('passes transformed variables through for subscriptions too', async () => {
    const operations = { watch: op('subscription', 'subscription Watch { tick }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ tick: 1 }]));

    const rpc = buildRpc(operations, transportOf(subscribe as any));
    const iterable = (rpc.watch as unknown as (vars: unknown) => AsyncIterable<unknown>)({ ids: ['a'] });

    for await (const _ of iterable) {
      break;
    }

    expect(subscribe).toHaveBeenCalledWith('subscription Watch { tick }', { ids: ['a'] }, undefined);
  });

  test('builds a method for every operation in the map, and a retrying one for a subscription', () => {
    const operations = {
      a: op('query', 'query A { a }'),
      b: op('mutation', 'mutation B { b }'),
      c: op('subscription', 'subscription C { c }'),
    } satisfies OperationMap;

    const rpc = buildRpc(operations, transportOf((() => toAsync([])) as any));

    expect(Object.keys(rpc)).toEqual(['a', 'b', 'c', 'cWithRetry']);
    expect(typeof (rpc as Record<string, unknown>)['a']).toBe('function');
  });

  test('a subscription has a second method that is sent again when its connection is lost', async () => {
    const operations = { watch: op('subscription', 'subscription Watch { tick }') } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ tick: 'plain' }]));
    const subscribeWithRetry = vi.fn(() => toAsync([{ tick: 'retried' }]));

    const rpc = buildRpc(operations, transportOf(subscribe, subscribeWithRetry)) as unknown as Record<
      string,
      (variables?: unknown) => AsyncIterable<unknown>
    >;

    await expect(Array.fromAsync(rpc['watch']!())).resolves.toEqual([{ tick: 'plain' }]);
    await expect(Array.fromAsync(rpc['watchWithRetry']!())).resolves.toEqual([{ tick: 'retried' }]);
    expect(subscribeWithRetry).toHaveBeenCalledWith('subscription Watch { tick }', undefined, undefined);
  });

  test('types the retrying method for subscriptions only', () => {
    type Operations = {
      watch: OperationDef<{ tick: number }, { from: number }, 'subscription'>;
      getUser: OperationDef<{ id: string }, Record<string, never>, 'query'>;
    };

    expectTypeOf<Rpc<Operations>['watchWithRetry']>().toEqualTypeOf<
      (variables: { from: number }, options?: OperationOptions | undefined) => AsyncIterable<{ tick: number }>
    >();
    expectTypeOf<Rpc<Operations>['getUser']>().toBeCallableWith();
    expectTypeOf<Rpc<Operations>['getUser']>().toBeCallableWith(undefined, { signal: new AbortController().signal });
    expectTypeOf<Rpc<Operations>>().not.toHaveProperty('getUserWithRetry');
  });

  test('queries and mutations have no retrying method', () => {
    const operations = {
      getUser: op('query', 'query GetUser { user { id } }'),
      doThing: op('mutation', 'mutation DoThing { thing }'),
    } satisfies OperationMap;

    expect(Object.keys(buildRpc(operations, transportOf(() => toAsync([]))))).toEqual(['getUser', 'doThing']);
  });

  test('refuses an operation named like the retrying method of a subscription', () => {
    const operations = {
      watch: op('subscription', 'subscription Watch { tick }'),
      watchWithRetry: op('query', 'query WatchWithRetry { tick }'),
    } satisfies OperationMap;

    expect(() => buildRpc(operations, transportOf(() => toAsync([])))).toThrow('collides');
  });

  test('passes the options of a call on to the transport', async () => {
    const operations = {
      getUser: op('query', 'query GetUser { user { id } }'),
      watch: op('subscription', 'subscription Watch { tick }'),
    } satisfies OperationMap;
    const subscribe = vi.fn(() => toAsync([{ user: { id: '1' } }]));
    const { signal } = new AbortController();

    const rpc = buildRpc(operations, transportOf(subscribe)) as unknown as Record<string, (...args: any[]) => any>;

    await rpc['getUser']!(undefined, { signal });
    await Array.fromAsync(rpc['watch']!(undefined, { signal }));

    expect(subscribe).toHaveBeenNthCalledWith(1, 'query GetUser { user { id } }', undefined, { signal });
    expect(subscribe).toHaveBeenNthCalledWith(2, 'subscription Watch { tick }', undefined, { signal });
  });
});
