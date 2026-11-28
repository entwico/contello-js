import type * as ContelloClientModule from '@contello/client';
import type { ContelloClientOptions, SourceDef } from '@contello/client';
import { type FakeContelloClient, createFakeContelloClient, createFakeSource } from '@contello/client/testing';
import { createAsyncIterableSubject } from '@entwico/dash/async';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createStore } from './store';
import type { UpdateBatch } from './watcher';

const created = vi.hoisted(() => ({
  client: undefined as unknown,
  options: [] as unknown[],
}));

vi.mock('@contello/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ContelloClientModule>()),
  createContelloClient: (options: unknown) => {
    created.options.push(options);

    return created.client;
  },
}));

type Article = { id: string; title: string };
type Config = { title: string };

const articleSource: SourceDef<'article', 'entity', Article> = {
  document: '',
  fragment: 'Article',
  subscription: 'articlesBatch',
  __model: 'article',
  __cardinality: 'entity',
};

const configSource: SourceDef<'config', 'singleton', Config> = {
  document: '',
  fragment: 'Config',
  subscription: 'config',
  __model: 'config',
  __cardinality: 'singleton',
};

const schema = {
  operations: {},
  sources: { articles: articleSource, config: configSource },
  models: { article: 'ArticleEntity', config: 'ConfigEntity' },
};

const connection = { url: 'http://contello.test', project: 'project-1', token: 'token-1' };

function setup() {
  const articles = createFakeSource<Article>([
    { id: 'a', title: 'first' },
    { id: 'b', title: 'second' },
  ]);
  const routes = createFakeSource([
    {
      __typename: 'ContelloRoute',
      id: 'r1',
      path: '/home',
      customHeaders: [],
      target: { __typename: 'ContelloRouteTargetText', content: 'hello', mimeType: 'text/plain' },
    },
  ]);
  const assets = createFakeSource([
    { id: 'asset-1', original: { uid: 'uid-1', mimeType: 'image/png', metadata: null }, preview: null, optimized: [] },
  ]);
  const messages = createFakeSource([
    { id: 'm1', token: 'home.title', translations: [{ language: 'en', value: 'Home' }] },
  ]);
  const upstream = createAsyncIterableSubject<unknown>();

  const fake: FakeContelloClient = createFakeContelloClient({
    subscribe(query, variables) {
      if (query.includes('contelloUpdatesBatch')) {
        return upstream;
      }

      if (query.includes('articlesBatch')) {
        return articles.subscribe(query, variables);
      }

      if (query.includes('contelloRoutesBatch')) {
        return routes.subscribe(query, variables);
      }

      if (query.includes('contelloAssetsBatch')) {
        return assets.subscribe(query, variables);
      }

      if (query.includes('contelloI18nMessagesBatch')) {
        return messages.subscribe(query, variables);
      }

      return { source: { title: 'the config' } };
    },
  });

  const lifecycle = {
    init: vi.spyOn(fake.client, 'init'),
    destroy: vi.spyOn(fake.client, 'destroy'),
    ping: vi.spyOn(fake.client, 'ping'),
  };

  created.client = fake.client;

  const store = createStore({ ...connection, schema });

  return {
    store,
    fake,
    lifecycle,
    articles,
    /** an update of one article, as the watcher subscription delivers it */
    updateArticle(article: Article) {
      articles.entities.set(article.id, article);
      upstream.next({
        contelloUpdatesBatch: {
          events: [{ mutation: { type: 'UPDATE' }, target: { __typename: 'ArticleEntity', id: article.id } }],
        },
      });
    },
  };
}

afterEach(() => {
  created.client = undefined;
  created.options.length = 0;
});

describe('store connection', () => {
  test('creates its client from the connection options', () => {
    const onConnected = vi.fn();
    const onReconnecting = vi.fn();
    const onError = vi.fn();
    const connectionEvents = { onClosed: vi.fn() };

    created.client = createFakeContelloClient().client;

    const store = createStore({
      ...connection,
      schema,
      connections: 3,
      onConnected,
      onReconnecting,
      onError,
      connectionEvents,
      operationTimeoutMs: 30_000,
    });

    expect(created.options).toEqual([
      {
        ...connection,
        schema,
        connections: 3,
        onConnected,
        onReconnecting,
        onError,
        connectionEvents,
        operationTimeoutMs: 30_000,
      },
    ] satisfies ContelloClientOptions<typeof schema>[]);
    expect(store.client).toBe(created.client);
  });

  test('gives its client no operation timeout unless it is asked for one', () => {
    created.client = createFakeContelloClient().client;

    createStore({ ...connection, schema });

    expect(created.options).toEqual([expect.objectContaining({ operationTimeoutMs: undefined })]);
  });

  test('init() connects the client and starts watching for updates', async () => {
    const { store, fake, lifecycle } = setup();

    expect(fake.calls).toEqual([]);

    await store.init();

    expect(lifecycle.init).toHaveBeenCalledTimes(1);
    await expect.poll(() => fake.open()).toBe(1);
    expect(fake.calls[0]!.query).toContain('contelloUpdatesBatch');

    await store.destroy();
  });

  test('destroy() stops watching and disconnects the client', async () => {
    const { store, fake, lifecycle } = setup();

    await store.init();
    await expect.poll(() => fake.open()).toBe(1);

    await store.destroy();

    expect(lifecycle.destroy).toHaveBeenCalledTimes(1);
    await expect.poll(() => fake.open()).toBe(0);
  });

  test('ping() asks the client', async () => {
    const { store, lifecycle } = setup();

    await store.ping();

    expect(lifecycle.ping).toHaveBeenCalledTimes(1);
  });
});

describe('store sources', () => {
  test('a collection is defined by the key of a schema source or by the source itself', async () => {
    const { store } = setup();

    const byKey = store.defineCollection('articles');
    const bySource = store.defineCollection(articleSource);

    expect(await byKey.get('a')).toEqual({ id: 'a', title: 'first' });
    expect(await bySource.get('b')).toEqual({ id: 'b', title: 'second' });

    await store.destroy();
  });

  test('a key the schema has no source for is refused', () => {
    const { store } = setup();

    expect(() => store.defineCollection('authors' as 'articles')).toThrow('no source named "authors"');
    expect(() => store.defineSingleton('settings' as 'config')).toThrow('no source named "settings"');
  });

  test('a store without a schema takes sources, not keys', async () => {
    created.client = createFakeContelloClient({ subscribe: () => ({ source: [{ id: 'a', title: 'first' }] }) }).client;

    const store = createStore(connection);

    expect(await store.defineCollection(articleSource).get('a')).toEqual({ id: 'a', title: 'first' });
    expect(() => store.defineCollection('articles' as never)).toThrow('no source named "articles"');

    await store.destroy();
  });

  test('collections map what they read', async () => {
    const { store } = setup();

    const titles = store.defineCollection('articles', { map: (article) => ({ id: article.id, upper: article.title.toUpperCase() }) });

    expect(await titles.get('a')).toEqual({ id: 'a', upper: 'FIRST' });

    await store.destroy();
  });

  test('a sync collection answers only after load()', async () => {
    const { store } = setup();
    const articles = store.defineCollectionSync('articles');

    expect(() => articles.get('a')).toThrow();

    await articles.load();

    expect(articles.get('a')).toEqual({ id: 'a', title: 'first' });
    expect(articles.getAll()).toHaveLength(2);

    await store.destroy();
  });

  test('a lazy collection fetches only what is asked for', async () => {
    const { store, articles } = setup();
    const lazy = store.defineLazyCollection('articles');

    expect(await lazy.get('b')).toEqual({ id: 'b', title: 'second' });
    expect(articles.fetched).toEqual([['b']]);

    await store.destroy();
  });

  test('singletons, async and sync', async () => {
    const { store } = setup();
    const config = store.defineSingleton('config');
    const configSync = store.defineSingletonSync(configSource);

    expect(await config.get()).toEqual({ title: 'the config' });
    expect(() => configSync.get()).toThrow();

    await configSync.load();

    expect(configSync.get()).toEqual({ title: 'the config' });

    await store.destroy();
  });
});

describe('store built-ins', () => {
  test('routes in every flavor read through the client of the store', async () => {
    const { store } = setup();
    const routes = store.defineRoutes();
    const routesSync = store.defineRoutesSync();
    const lazyRoutes = store.defineLazyRoutes();

    await routesSync.load();

    expect(await routes.getByPath('/home')).toMatchObject({ id: 'r1', type: 'text' });
    expect(routesSync.getByPath('/home')).toMatchObject({ id: 'r1', type: 'text' });
    expect(await lazyRoutes.getByPath('/home')).toMatchObject({ id: 'r1', type: 'text' });

    await store.destroy();
  });

  test('assets in every flavor read through the client of the store', async () => {
    const { store } = setup();
    const assets = store.defineAssets();
    const assetsSync = store.defineAssetsSync();
    const lazyAssets = store.defineLazyAssets();

    await assetsSync.load();

    expect(await assets.get('asset-1')).toMatchObject({ id: 'asset-1', original: { uid: 'uid-1' } });
    expect(assetsSync.get('asset-1')).toMatchObject({ id: 'asset-1', original: { uid: 'uid-1' } });
    expect(await lazyAssets.get('asset-1')).toMatchObject({ id: 'asset-1', original: { uid: 'uid-1' } });

    await store.destroy();
  });

  test('i18n messages read the collection they are defined for', async () => {
    const { store, fake } = setup();
    const messages = store.defineI18nMessages({ collection: 'website' });

    const all = await messages.getAll();

    expect(all.map((message) => message.token)).toEqual(['home.title']);
    expect(fake.calls.at(-1)!.variables).toMatchObject({ collection: 'website' });

    await store.destroy();
  });
});

describe('store updates', () => {
  test('an upstream update refreshes the collections of that model', async () => {
    const { store, fake, articles, updateArticle } = setup();
    const collection = store.defineCollection('articles');

    await store.init();
    await collection.load();
    await expect.poll(() => fake.open()).toBe(1);

    updateArticle({ id: 'a', title: 'changed' });

    await vi.waitFor(async () => expect(await collection.get('a')).toEqual({ id: 'a', title: 'changed' }));
    expect(articles.fetched).toEqual([undefined, ['a']]);

    await store.destroy();
  });

  test('updates$ hands every batch to its readers', async () => {
    const { store, fake, updateArticle } = setup();
    const batches: UpdateBatch[] = [];

    await store.init();
    await expect.poll(() => fake.open()).toBe(1);

    const drained = (async () => {
      for await (const batch of store.updates$) {
        batches.push(batch);
      }
    })();

    updateArticle({ id: 'a', title: 'changed' });

    await vi.waitFor(() => expect(batches).toHaveLength(1));

    expect(batches[0]!.events).toEqual([{ id: 'a', mutation: 'update', target: 'entity', model: 'article' }]);

    await store.destroy();
    await drained;
  });

  test('after destroy() nothing it defined reacts to updates', async () => {
    const { store, fake, articles, updateArticle } = setup();
    const collection = store.defineCollection('articles');

    await store.init();
    await collection.load();
    await expect.poll(() => fake.open()).toBe(1);

    await store.destroy();

    updateArticle({ id: 'a', title: 'changed' });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(articles.fetched).toEqual([undefined]);
  });
});
