import { createAsyncIterableSubject } from '@entwico/dash/async';
import { describe, expect, test } from 'vitest';

import { createFakeContelloClient, createFakeSource } from './testing';

describe('a fake contello client', () => {
  test('answers a subscription with the one message of its handler, then completes', async () => {
    const { client, calls, open } = createFakeContelloClient({ subscribe: () => ({ greeting: 'hello' }) });

    await expect(Array.fromAsync(client.subscribe('{ greeting }', { locale: 'de' }))).resolves.toEqual([
      { greeting: 'hello' },
    ]);

    expect(calls).toEqual([{ kind: 'subscribe', query: '{ greeting }', variables: { locale: 'de' } }]);
    expect(open()).toBe(0);
  });

  test('passes on the messages of a subscription that stays open, until it is closed', async () => {
    const updates = createAsyncIterableSubject<number>();
    const { client, open } = createFakeContelloClient({ subscribe: () => updates });
    const seen: number[] = [];

    const reading = (async () => {
      for await (const update of client.subscribe<number>('subscription { updates }')) {
        seen.push(update);

        if (update === 2) {
          break;
        }
      }
    })();

    await expect.poll(() => open()).toBe(1);
    updates.next(1);
    updates.next(2);
    await reading;

    expect(seen).toEqual([1, 2]);
    expect(open()).toBe(0);
  });

  test('closes a subscription that is closed while it waits', async () => {
    const updates = createAsyncIterableSubject<number>();
    const { client, open } = createFakeContelloClient({ subscribe: () => updates });
    const iterator = client.subscribe('subscription { updates }')[Symbol.asyncIterator]();
    const waiting = iterator.next();

    await expect.poll(() => open()).toBe(1);
    await iterator.return?.();

    expect(open()).toBe(0);
    await expect(waiting).resolves.toEqual({ value: undefined, done: true });
  });

  test('starts a subscription of its own for every iteration', async () => {
    let answers = 0;
    const { client, calls } = createFakeContelloClient({ subscribe: () => ++answers });
    const subscription = client.subscribe<number>('{ counter }');

    await expect(Array.fromAsync(subscription)).resolves.toEqual([1]);
    await expect(Array.fromAsync(subscription)).resolves.toEqual([2]);
    expect(calls).toHaveLength(2);
  });

  test.each([
    ['throws', () => {
      throw new Error('contello is down');
    }],
    ['rejects', () => Promise.reject(new Error('contello is down'))],
  ])('fails a subscription whose handler %s', async (_name, subscribe) => {
    const { client, open } = createFakeContelloClient({ subscribe });

    await expect(Array.fromAsync(client.subscribe('{ greeting }'))).rejects.toThrow('contello is down');
    expect(open()).toBe(0);
  });

  test('collects every message of a subscription that ends', async () => {
    async function* batches() {
      yield { source: [1, 2] };
      yield { source: [3] };
    }

    const { client, calls, open } = createFakeContelloClient({ subscribe: () => batches() });

    await expect(client.collect('subscription { source }')).resolves.toEqual([{ source: [1, 2] }, { source: [3] }]);
    expect(calls).toEqual([{ kind: 'subscribe', query: 'subscription { source }', variables: undefined }]);
    expect(open()).toBe(0);
  });

  test('ends a call with the reason of its signal, without waiting for the handler', async () => {
    const { client } = createFakeContelloClient({ subscribe: () => new Promise(() => {}) });
    const controller = new AbortController();
    const options = { signal: controller.signal };

    const calls = [
      client.execute('{ greeting }', undefined, options),
      client.collect('subscription { source }', undefined, options),
      Array.fromAsync(client.subscribe('subscription { source }', undefined, options)),
    ];

    controller.abort(new Error('cancelled'));

    for (const call of calls) {
      await expect(call).rejects.toThrow('cancelled');
    }
  });

  test('answers execute with its own handler', async () => {
    const { client, calls } = createFakeContelloClient({ execute: (_query, variables) => ({ result: variables }) });

    await expect(client.execute('mutation { result: createThing }', { id: 'a' })).resolves.toEqual({
      result: { id: 'a' },
    });

    expect(calls).toEqual([{ kind: 'execute', query: 'mutation { result: createThing }', variables: { id: 'a' } }]);
  });

  test('answers execute with the first message of the subscription when it has no handler of its own', async () => {
    const { client, calls, open } = createFakeContelloClient({ subscribe: () => ({ greeting: 'hello' }) });

    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });

    expect(calls).toEqual([{ kind: 'execute', query: '{ greeting }', variables: undefined }]);
    expect(open()).toBe(0);
  });

  test('has the lifecycle of a client, with nothing behind it', async () => {
    const { client } = createFakeContelloClient();

    await expect(client.init()).resolves.toBeUndefined();
    await expect(client.ping()).resolves.toBeUndefined();
    await expect(client.destroy()).resolves.toBeUndefined();
  });
});

describe('a fake source', () => {
  type Article = { id: string; title: string };

  const first: Article = { id: 'a', title: 'first' };
  const second: Article = { id: 'b', title: 'second' };

  test('serves all entities, or the ones that are asked for', async () => {
    const articles = createFakeSource([first, second]);
    const { client } = createFakeContelloClient({ subscribe: articles.subscribe });

    await expect(client.execute('subscription { source }')).resolves.toEqual({ source: [first, second] });
    await expect(client.execute('subscription { source }', { ids: ['b', 'missing'] })).resolves.toEqual({
      source: [second],
    });

    expect(articles.fetched).toEqual([undefined, ['b', 'missing']]);
  });

  test('serves what a test changed', async () => {
    const articles = createFakeSource([first]);
    const { client } = createFakeContelloClient({ subscribe: articles.subscribe });

    articles.entities.set('a', { id: 'a', title: 'changed' });
    articles.entities.set('b', second);

    await expect(client.execute('subscription { source }')).resolves.toEqual({
      source: [{ id: 'a', title: 'changed' }, second],
    });

    articles.entities.delete('a');

    await expect(client.execute('subscription { source }', { ids: ['a'] })).resolves.toEqual({ source: [] });
  });
});
