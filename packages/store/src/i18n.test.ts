import { type ContelloClient, createAsyncIterableSubject } from '@contello/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createI18nMessagesCollection } from './i18n';
import { createRefreshByTtlQueue } from './utils';
import type { UpdateBatch } from './watcher';

type RawMessage = { id: string; token: string; translations: { language: string; value: string }[] };

function makeClient(messagesByCall: RawMessage[][]): {
  client: ContelloClient<any>;
  callCount: () => number;
} {
  let callIndex = 0;

  const client = {
    subscribe<T>(_query: string, _variables?: Record<string, unknown> | undefined): AsyncIterable<T> {
      const msgs = messagesByCall[callIndex] ?? messagesByCall[messagesByCall.length - 1]!;

      callIndex += 1;

      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          let yielded = false;

          return {
            async next(): Promise<IteratorResult<T>> {
              if (yielded) {
                return { value: undefined as unknown as T, done: true };
              }

              yielded = true;

              return { value: { contelloI18nMessagesBatch: msgs } as unknown as T, done: false };
            },
            async return(): Promise<IteratorResult<T>> {
              return { value: undefined as unknown as T, done: true };
            },
          };
        },
      };
    },
  } as unknown as ContelloClient<any>;

  return { client, callCount: () => callIndex };
}

describe('i18n refresh-by-ttl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('first get() arms the ttl timer; full refresh fires after ttl', async () => {
    const { client, callCount } = makeClient([
      [{ id: '1', token: 'hello', translations: [{ language: 'en', value: 'Hello' }] }],
      [{ id: '1', token: 'hello', translations: [{ language: 'en', value: 'Hi' }] }],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: 1000 } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await Promise.resolve(i18n.getAll());
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    i18n.destroy();
  });

  test('ttl: 0 disables periodic refresh', async () => {
    const { client, callCount } = makeClient([[{ id: '1', token: 'hello', translations: [] }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: 0 } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await Promise.resolve(i18n.getAll());
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(callCount()).toBe(1);

    i18n.destroy();
  });

  test('default ttl applies when cache is not set', async () => {
    const { client, callCount } = makeClient([[{ id: '1', token: 'hello', translations: [] }]]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const i18n = createI18nMessagesCollection({ collection: 'site' }, client, updates$, createRefreshByTtlQueue());

    await Promise.resolve(i18n.getAll());
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 - 1000);
    expect(callCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(callCount()).toBe(2));

    i18n.destroy();
  });

  test('refresh() method triggers a full refresh', async () => {
    const { client, callCount } = makeClient([
      [{ id: '1', token: 'hello', translations: [] }],
      [{ id: '1', token: 'hello', translations: [] }],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: false } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await Promise.resolve(i18n.getAll());
    expect(callCount()).toBe(1);

    i18n.refresh();

    await vi.waitFor(() => expect(callCount()).toBe(2));

    i18n.destroy();
  });
});
