import { createFakeContelloClient } from '@contello/client/testing';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ModelResolver } from './model-resolver';
import { type UpdateBatch, createInternalWatcher } from './watcher';

type RawTarget = Record<string, unknown>;
type RawEvent = { mutation: { type: 'CREATE' | 'UPDATE' | 'DELETE' }; target: RawTarget | null; prev?: RawTarget | null };

function textRoute(id: string, path: string): RawTarget {
  return {
    __typename: 'ContelloRoute',
    id,
    path,
    customHeaders: [],
    target: { __typename: 'ContelloRouteTargetText', content: id, mimeType: 'text/plain' },
  };
}

function entityRoute(id: string, path: string, entityType: string): RawTarget {
  return {
    __typename: 'ContelloRoute',
    id,
    path,
    customHeaders: [],
    target: { __typename: 'ContelloRouteTargetEntity', entity: { __typename: entityType, id: `${id}-entity` } },
  };
}

function event(type: RawEvent['mutation']['type'], target: RawEvent['target'], prev?: RawTarget | undefined): RawEvent {
  return { mutation: { type }, target, ...(prev && { prev }) };
}

async function startWatcher(models?: Record<string, string> | undefined) {
  const source = createAsyncIterableSubject<unknown>();
  const fake = createFakeContelloClient({ subscribe: () => source });
  const watcher = createInternalWatcher(fake.client, new ModelResolver(models));
  const batches: UpdateBatch[] = [];

  watcher.updates$.subscribe((batch) => void batches.push(batch));
  watcher.start();

  await expect.poll(() => fake.open()).toBe(1);

  return {
    watcher,
    fake,
    batches,
    push: (...events: RawEvent[]) => source.next({ contelloUpdatesBatch: { events } }),
    pushRaw: (message: unknown) => source.next(message),
    /** the one batch the pushed events end up in */
    async batch(...events: RawEvent[]): Promise<UpdateBatch> {
      const index = batches.length;

      source.next({ contelloUpdatesBatch: { events } });

      await vi.waitFor(() => expect(batches.length).toBeGreaterThan(index));

      return batches[index]!;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('watcher event mapping', () => {
  test('an entity event carries the model its typename stands for', async () => {
    const { watcher, batch } = await startWatcher({ article: 'ArticleEntity' });

    const { events } = await batch(
      event('CREATE', { __typename: 'ArticleEntity', id: '1' }),
      event('UPDATE', { __typename: 'ArticleEntity', id: '2' }),
      event('DELETE', { __typename: 'ArticleEntity', id: '3' }),
    );

    expect(events).toEqual([
      { id: '1', mutation: 'create', target: 'entity', model: 'article' },
      { id: '2', mutation: 'update', target: 'entity', model: 'article' },
      { id: '3', mutation: 'delete', target: 'entity', model: 'article' },
    ]);

    watcher.stop();
  });

  test('without a schema an entity event carries its typename', async () => {
    const { watcher, batch } = await startWatcher();

    const { events } = await batch(event('UPDATE', { __typename: 'ArticleEntity', id: '1' }));

    expect(events).toEqual([{ id: '1', mutation: 'update', target: 'entity', model: 'ArticleEntity' }]);

    watcher.stop();
  });

  test('drops events of types the schema does not know', async () => {
    const { watcher, batch } = await startWatcher({ article: 'ArticleEntity' });

    const { events } = await batch(
      event('UPDATE', { __typename: 'UnknownEntity', id: '1' }),
      event('UPDATE', { id: '2' }),
      event('UPDATE', { __typename: 'ArticleEntity', id: '3' }),
    );

    expect(events.map((e) => e.id)).toEqual(['3']);

    watcher.stop();
  });

  test('maps asset and i18n message events', async () => {
    const { watcher, batch } = await startWatcher();

    const result = await batch(
      event('UPDATE', { __typename: 'ContelloAsset', id: 'asset-1' }),
      event('DELETE', { __typename: 'ContelloI18nMessage', id: 'message-1', token: 'home.title' }),
    );

    expect(result.asset).toEqual([{ id: 'asset-1', mutation: 'update', target: 'asset' }]);
    expect(result.i18nMessage).toEqual([
      { id: 'message-1', mutation: 'delete', target: 'i18nMessage', token: 'home.title' },
    ]);

    watcher.stop();
  });

  test('a created route carries its state, an updated one also the previous state', async () => {
    const { watcher, batch } = await startWatcher();

    const { route } = await batch(
      event('CREATE', textRoute('1', '/new')),
      event('UPDATE', textRoute('2', '/after'), textRoute('2', '/before')),
    );

    expect(route).toEqual([
      { id: '1', mutation: 'create', target: 'route', after: expect.objectContaining({ path: '/new', type: 'text' }) },
      {
        id: '2',
        mutation: 'update',
        target: 'route',
        after: expect.objectContaining({ path: '/after' }),
        before: expect.objectContaining({ path: '/before' }),
      },
    ]);

    watcher.stop();
  });

  test('a deleted route needs no state', async () => {
    const { watcher, batch } = await startWatcher();

    const { route } = await batch(event('DELETE', { __typename: 'ContelloRoute', id: '1' }));

    expect(route).toEqual([{ id: '1', mutation: 'delete', target: 'route' }]);

    watcher.stop();
  });

  test('drops a route event whose state cannot be mapped', async () => {
    const { watcher, batch } = await startWatcher();
    const unsupported = { ...textRoute('1', '/x'), target: { __typename: 'ContelloRouteTargetFuture' } };

    const { route } = await batch(
      event('CREATE', unsupported),
      // an update without the previous state
      event('UPDATE', textRoute('2', '/after')),
      event('UPDATE', textRoute('3', '/after'), { __typename: 'ContelloAsset', id: '3' }),
      event('CREATE', textRoute('4', '/kept')),
    );

    expect(route.map((e) => e.id)).toEqual(['4']);

    watcher.stop();
  });
});

describe('watcher batches', () => {
  test('groups entity events by model', async () => {
    const { watcher, batch } = await startWatcher({ article: 'ArticleEntity', author: 'AuthorEntity' });

    const { entity, events } = await batch(
      event('UPDATE', { __typename: 'ArticleEntity', id: '1' }),
      event('UPDATE', { __typename: 'AuthorEntity', id: '2' }),
      event('DELETE', { __typename: 'ArticleEntity', id: '3' }),
    );

    expect(events).toHaveLength(3);
    expect(entity.keys().toArray()).toEqual(['article', 'author']);
    expect(entity.get('article')!.map((e) => e.id)).toEqual(['1', '3']);
    expect(entity.get('author')!.map((e) => e.id)).toEqual(['2']);

    watcher.stop();
  });

  test('groups route events by the model of the entity they lead to, before and after', async () => {
    const { watcher, batch } = await startWatcher({ article: 'ArticleEntity', author: 'AuthorEntity' });

    const { routeByEntityModel } = await batch(
      event('CREATE', entityRoute('1', '/a', 'ArticleEntity')),
      event('UPDATE', entityRoute('2', '/b', 'AuthorEntity'), entityRoute('2', '/b', 'ArticleEntity')),
      event('CREATE', textRoute('3', '/text')),
      event('DELETE', { __typename: 'ContelloRoute', id: '4' }),
    );

    expect(routeByEntityModel.keys().toArray()).toEqual(['article', 'author']);
    expect(routeByEntityModel.get('article')!.map((e) => e.id)).toEqual(['1', '2']);
    expect(routeByEntityModel.get('author')!.map((e) => e.id)).toEqual(['2']);

    watcher.stop();
  });

  test('emits nothing for a message without usable events', async () => {
    const { watcher, batches, push, pushRaw, batch } = await startWatcher({ article: 'ArticleEntity' });

    push();
    pushRaw({ contelloUpdatesBatch: null });
    push(event('UPDATE', { __typename: 'UnknownEntity', id: '1' }));

    await batch(event('UPDATE', { __typename: 'ArticleEntity', id: '2' }));

    expect(batches).toHaveLength(1);

    watcher.stop();
  });

  test('a malformed event is skipped and the rest of its message delivered', async () => {
    const { watcher, batch } = await startWatcher();

    const { events } = await batch(
      event('UPDATE', null),
      event('CREATE', { __typename: 'ContelloRoute', id: '1' }),
      event('UPDATE', { __typename: 'ContelloAsset', id: '2' }),
    );

    expect(events).toEqual([{ id: '2', mutation: 'update', target: 'asset' }]);

    watcher.stop();
  });
});

describe('watcher lifecycle', () => {
  test('a subscriber that throws does not end the stream', async () => {
    const { watcher, batch } = await startWatcher();
    const seen: string[] = [];

    watcher.updates$.subscribe((update) => {
      const id = update.events[0]!.id;

      seen.push(id);

      if (id === '1') {
        throw new Error('subscriber failed');
      }
    });

    await batch(event('UPDATE', { __typename: 'ContelloAsset', id: '1' }));
    await batch(event('UPDATE', { __typename: 'ContelloAsset', id: '2' }));

    expect(seen).toEqual(['1', '2']);

    watcher.stop();
  });

  test('start() twice opens one subscription', async () => {
    const { watcher, fake } = await startWatcher();

    watcher.start();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.calls).toHaveLength(1);

    watcher.stop();
  });

  test('stop() ends the update stream', async () => {
    const { watcher } = await startWatcher();
    const ended = vi.fn();

    void (async () => {
      for await (const _ of watcher.updates$) {
        // drained until the stream ends
      }

      ended();
    })();

    watcher.stop();

    await vi.waitFor(() => expect(ended).toHaveBeenCalled());
  });

  test('subscribes again when its subscription ends, and goes on delivering', async () => {
    vi.useFakeTimers();

    const sources = [createAsyncIterableSubject<unknown>(), createAsyncIterableSubject<unknown>()];
    let subscriptions = 0;
    const fake = createFakeContelloClient({ subscribe: () => sources[subscriptions++]! });
    const watcher = createInternalWatcher(fake.client, new ModelResolver(undefined));
    const batches: UpdateBatch[] = [];

    watcher.updates$.subscribe((batch) => void batches.push(batch));
    watcher.start();

    await vi.waitFor(() => expect(fake.open()).toBe(1));

    sources[0]!.complete();

    // past the first backoff and its jitter
    await vi.advanceTimersByTimeAsync(5000);

    expect(fake.calls).toHaveLength(2);
    expect(fake.open()).toBe(1);

    sources[1]!.next({ contelloUpdatesBatch: { events: [event('UPDATE', { __typename: 'ContelloAsset', id: '1' })] } });

    await vi.waitFor(() => expect(batches).toHaveLength(1));

    watcher.stop();
  });
});
