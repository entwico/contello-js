import type { ContelloClient } from '@contello/client';
import { createFakeContelloClient } from '@contello/client/testing';
import { createAsyncIterableSubject } from '@entwico/dash/async';
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

  const { client } = createFakeContelloClient({
    subscribe() {
      const msgs = messagesByCall[callIndex] ?? messagesByCall.at(-1)!;

      callIndex += 1;

      return { source: msgs };
    },
  });

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

  test('upstream update event refetches only the changed id (server-side partial)', async () => {
    const initialMsgs = [
      { id: '1', token: 'hello', translations: [{ language: 'en', value: 'Hello' }] },
      { id: '2', token: 'bye', translations: [{ language: 'en', value: 'Bye' }] },
    ];
    const updatedMsg1 = { id: '1', token: 'hello', translations: [{ language: 'en', value: 'Hi' }] };

    const calls: (string[] | undefined)[] = [];

    const { client } = createFakeContelloClient({
      subscribe(_query, vars) {
        const ids = vars?.['ids'] as string[] | undefined;

        calls.push(ids ? [...ids] : undefined);

        const msgs = ids
          ? initialMsgs.filter((m) => ids.includes(m.id)).map((m) => (m.id === '1' ? updatedMsg1 : m))
          : initialMsgs;

        return { source: msgs };
      },
    });

    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: false }, onRefresh },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    const initial = await Promise.resolve(i18n.getAll());

    expect(initial).toHaveLength(2);
    expect(calls).toEqual([undefined]);

    updates$.next({
      entity: new Map(),
      events: [],
      route: [],
      asset: [],
      i18nMessage: [{ id: '1', mutation: 'update', target: 'i18nMessage', token: 'hello' } as any],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    // server-side partial — the second fetch only requests the changed id
    expect(calls).toEqual([undefined, ['1']]);
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['1'], kind: 'upstream-update' });

    i18n.destroy();
  });

  test('delete-only event removes the entry locally without a follow-up fetch', async () => {
    const { client, callCount } = makeClient([
      [
        { id: '1', token: 'hello', translations: [] },
        { id: '2', token: 'bye', translations: [] },
      ],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();
    const onRefresh = vi.fn();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: false }, onRefresh },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await Promise.resolve(i18n.getAll());

    updates$.next({
      entity: new Map(),
      events: [],
      route: [],
      asset: [],
      i18nMessage: [{ id: '2', mutation: 'delete', target: 'i18nMessage', token: 'bye' } as any],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());

    // no follow-up fetch — only the initial full fetch
    expect(callCount()).toBe(1);
    expect(onRefresh).toHaveBeenLastCalledWith({ ids: ['2'], kind: 'upstream-update' });

    const remaining = await Promise.resolve(i18n.getAll());

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('1');

    i18n.destroy();
  });

  test('partial refresh from upstream does NOT reset the ttl timer', async () => {
    const { client, callCount } = makeClient([
      [{ id: '1', token: 'hello', translations: [] }],
      [{ id: '1', token: 'hello', translations: [] }],
      [{ id: '1', token: 'hello', translations: [] }],
    ]);
    const updates$ = createAsyncIterableSubject<UpdateBatch>();

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: 10_000 } },
      client,
      updates$,
      createRefreshByTtlQueue(),
    );

    await Promise.resolve(i18n.getAll());
    expect(callCount()).toBe(1);

    // halfway through the ttl window, an update event arrives → partial refresh
    await vi.advanceTimersByTimeAsync(5000);
    updates$.next({
      entity: new Map(),
      events: [],
      route: [],
      asset: [],
      i18nMessage: [{ id: '1', mutation: 'update', target: 'i18nMessage', token: 'hello' } as any],
      routeByEntityModel: new Map(),
    } as unknown as UpdateBatch);

    await vi.waitFor(() => expect(callCount()).toBe(2));

    // ttl timer should still fire at t=10_000, not t=15_000
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(callCount()).toBe(3));

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

describe('i18n lookups and registration', () => {
  function createMessages(messages: RawMessage[]) {
    const registered: Record<string, unknown>[] = [];
    const { client } = createFakeContelloClient({
      subscribe: () => ({ source: messages }),
      execute(_query, variables) {
        registered.push(variables ?? {});

        return {};
      },
    });

    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: false } },
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      createRefreshByTtlQueue(),
    );

    return { i18n, registered };
  }

  test('a message is found by its id, with its translations by language', async () => {
    const { i18n } = createMessages([
      {
        id: '1',
        token: 'hello',
        translations: [
          { language: 'en', value: 'Hello' },
          { language: 'de', value: 'Hallo' },
        ],
      },
      { id: '2', token: 'bye', translations: [] },
    ]);

    const message = await i18n.get('1');

    expect(message!.token).toBe('hello');
    expect([...message!.translations]).toEqual([
      ['en', 'Hello'],
      ['de', 'Hallo'],
    ]);

    const several = await i18n.get(['2', 'missing']);

    expect(several.map((found) => found.token)).toEqual(['bye']);
    expect(await i18n.get('missing')).toBeUndefined();

    i18n.destroy();
  });

  test('register() sends the messages to the collection', async () => {
    const { i18n, registered } = createMessages([]);

    await i18n.register([
      {
        token: 'cart.items',
        example: '3 items',
        description: 'cart size',
        variables: [{ name: 'count', description: 'number of items', example: '3' }],
        translations: [{ language: 'de', message: '{$count} Artikel' }],
        initialTranslations: [{ language: 'en', message: '{$count} items' }],
      },
      { token: 'home.title' },
    ]);

    expect(registered).toEqual([
      {
        collection: 'site',
        messages: [
          {
            token: 'cart.items',
            example: '3 items',
            description: 'cart size',
            variables: [{ name: 'count', description: 'number of items', example: '3' }],
            translations: [{ language: 'de', message: '{$count} Artikel' }],
            initialTranslations: [{ language: 'en', message: '{$count} items' }],
          },
          {
            token: 'home.title',
            example: undefined,
            description: undefined,
            variables: undefined,
            translations: undefined,
            initialTranslations: undefined,
          },
        ],
      },
    ]);

    i18n.destroy();
  });

  test('register() rejects when the server refuses', async () => {
    const { client } = createFakeContelloClient({
      execute: () => Promise.reject(new Error('not allowed')),
    });
    const i18n = createI18nMessagesCollection(
      { collection: 'site', cache: { ttl: false } },
      client,
      createAsyncIterableSubject<UpdateBatch>(),
      createRefreshByTtlQueue(),
    );

    await expect(i18n.register([{ token: 'home.title' }])).rejects.toThrow('not allowed');

    i18n.destroy();
  });
});
