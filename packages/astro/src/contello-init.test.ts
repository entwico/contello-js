import type * as ContelloClientModule from '@contello/client';
import { type FakeContelloClient, createFakeContelloClient, createFakeSource } from '@contello/client/testing';
import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { type ContelloInitI18nOptions, createContello } from './contello';
import type { AnyRoutes } from './routing-middleware';

type HealthCheck = { name: string; check: () => Promise<void>; optional?: boolean; timeout?: number };
type ExtractedKey = {
  key: string;
  meta: {
    fallback: string;
    description?: string;
    variables?: Record<string, { description?: string; fallback?: string } | undefined>;
  };
};

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  boot: undefined as { dev: boolean } | undefined,
  healthChecks: [] as unknown[],
  unregisterHealthCheck: vi.fn(),
  i18nConfig: undefined as unknown,
  manifestKeys: [] as unknown[],
  configure: vi.fn(),
  setTranslations: vi.fn(),
}));

vi.mock('@astroscope/node/boot', () => ({ getBootContext: () => mocks.boot }));

vi.mock('@astroscope/node/health', () => ({
  registerHealthCheck: (check: unknown) => {
    mocks.healthChecks.push(check);

    return mocks.unregisterHealthCheck;
  },
}));

vi.mock('@astroscope/i18n', () => ({
  i18n: {
    configure: async (config: unknown) => {
      mocks.configure(config);
      mocks.i18nConfig = config;
    },
    getConfig: () => mocks.i18nConfig,
    getManifest: () => ({ keys: mocks.manifestKeys }),
    setTranslations: mocks.setTranslations,
  },
}));

vi.mock('@contello/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ContelloClientModule>()),
  createContelloClient: () => mocks.client,
}));

const connection = { url: 'http://contello.test', project: 'project-1', token: 'token-1' };

const i18nOptions = {
  locales: ['en', 'de'],
  defaultLocale: 'en',
} as unknown as ContelloInitI18nOptions;

function message(id: string, token: string, translations: Record<string, string>) {
  return {
    id,
    token,
    translations: Object.entries(translations).map(([language, value]) => ({ language, value })),
  };
}

function setup(options?: { i18n?: boolean | undefined }) {
  const routes = createFakeSource([
    {
      __typename: 'ContelloRoute',
      id: 'r1',
      path: '/home',
      customHeaders: [],
      target: { __typename: 'ContelloRouteTargetText', content: 'hello', mimeType: 'text/plain' },
    },
  ]);
  const messages = createFakeSource([message('m1', 'home.title', { en: 'Home', de: 'Start', fr: 'Accueil' })]);
  const registrations: Record<string, unknown>[] = [];

  const fake: FakeContelloClient = createFakeContelloClient({
    subscribe(query, variables) {
      if (query.includes('contelloUpdatesBatch')) {
        // open for as long as the store watches
        return new ReadableStream();
      }

      if (query.includes('contelloI18nMessagesBatch')) {
        return messages.subscribe(query, variables);
      }

      return routes.subscribe(query, variables);
    },
    execute(_query, variables) {
      registrations.push(variables ?? {});

      return {};
    },
  });

  const ping = vi.spyOn(fake.client, 'ping');
  const destroy = vi.spyOn(fake.client, 'destroy');

  mocks.client = fake.client;

  const contello = createContello({ ...connection, ...(options?.i18n && { i18n: { collection: 'website' } }) });

  return { contello, fake, routes, messages, registrations, ping, destroy };
}

function translationsOf(locale: string): unknown {
  return mocks.setTranslations.mock.calls.findLast(([language]) => language === locale)?.[1];
}

afterEach(() => {
  mocks.client = undefined;
  mocks.boot = undefined;
  mocks.healthChecks.length = 0;
  mocks.i18nConfig = undefined;
  mocks.manifestKeys.length = 0;
  vi.clearAllMocks();
});

describe('Contello.init routes', () => {
  test('\'sync\' loads the routes, so lookups answer synchronously once ready', async () => {
    const { contello, routes } = setup();

    await contello.init({ routes: 'sync' });

    expect(contello.isReady).toBe(true);
    expect(routes.fetched).toEqual([undefined]);
    expect(contello.routes.getByPath('/home')).toMatchObject({ id: 'r1', type: 'text', content: 'hello' });

    await contello.destroy();
  });

  test('\'lazy\' fetches a route only when it is asked for', async () => {
    const { contello, routes } = setup();

    await contello.init({ routes: 'lazy' });

    expect(routes.fetched).toEqual([]);
    expect(await contello.routes.getByPath('/home')).toMatchObject({ id: 'r1' });
    expect(routes.fetched).toHaveLength(1);

    await contello.destroy();
  });

  test('false leaves the instance without routes', async () => {
    const { contello, routes } = setup();

    await contello.init({ routes: false });

    expect(contello.isReady).toBe(true);
    expect(() => contello.routes).toThrow(/routes disabled/);
    expect(routes.fetched).toEqual([]);

    await contello.destroy();
  });

  test('takes routes the project defined itself and loads them', async () => {
    const { contello, routes } = setup();
    const own = contello.defineRoutesSync();

    await contello.init({ routes: own });

    expect(contello.routes).toBe(own);
    expect(routes.fetched).toEqual([undefined]);
    expect(own.getByPath('/home')).toMatchObject({ id: 'r1' });

    await contello.destroy();
  });

  test('loads what the project hands over before it is ready', async () => {
    const { contello } = setup();
    const readyAtLoad: boolean[] = [];
    const loadable = {
      load: vi.fn(async () => {
        readyAtLoad.push(contello.isReady);
      }),
    };

    await contello.init({ routes: false, load: [loadable, loadable] });

    expect(loadable.load).toHaveBeenCalledTimes(2);
    expect(readyAtLoad).toEqual([false, false]);
    expect(contello.isReady).toBe(true);

    await contello.destroy();
  });
});

describe('Contello.init health check', () => {
  test('registers a check named contello that pings the client', async () => {
    const { contello, ping } = setup();

    await contello.init({ routes: false });

    const [check] = mocks.healthChecks as HealthCheck[];

    expect(mocks.healthChecks).toHaveLength(1);
    expect(check).toMatchObject({ name: 'contello', optional: undefined, timeout: undefined });

    await check!.check();

    expect(ping).toHaveBeenCalledTimes(1);

    await contello.destroy();
  });

  test('passes the health options on', async () => {
    const { contello } = setup();

    await contello.init({ routes: false, health: { name: 'cms', optional: true, timeout: 500 } });

    expect(mocks.healthChecks).toEqual([expect.objectContaining({ name: 'cms', optional: true, timeout: 500 })]);

    await contello.destroy();
  });

  test('registers none with health: false', async () => {
    const { contello } = setup();

    await contello.init({ routes: false, health: false });

    expect(mocks.healthChecks).toEqual([]);

    await contello.destroy();
  });
});

describe('Contello.destroy', () => {
  test('takes the instance back to its state before init()', async () => {
    const { contello, destroy } = setup({ i18n: true });

    await contello.init({ routes: 'sync', i18n: i18nOptions });
    await contello.destroy();

    expect(contello.isReady).toBe(false);
    expect(() => contello.routes).toThrow(/accessed before init/);
    expect(() => contello.i18nMessages).toThrow(/accessed before init/);
    expect(mocks.unregisterHealthCheck).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('a failed init() cleans up and rejects with the cause', async () => {
    const { contello, destroy } = setup();
    const cause = new Error('load failed');

    await expect(contello.init({ routes: 'sync', load: [{ load: () => Promise.reject(cause) }] })).rejects.toBe(cause);

    expect(contello.isReady).toBe(false);
    expect(() => contello.routes).toThrow(/accessed before init/);
    expect(mocks.unregisterHealthCheck).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('a failing cleanup does not hide why init() failed', async () => {
    const { contello, destroy } = setup();
    const cause = new Error('load failed');

    destroy.mockRejectedValueOnce(new Error('destroy failed'));

    await expect(contello.init({ routes: false, load: [{ load: () => Promise.reject(cause) }] })).rejects.toBe(cause);
  });
});

describe('Contello.init i18n', () => {
  test('refuses an i18n collection without the i18n runtime options', async () => {
    const { contello } = setup({ i18n: true });

    await expect(contello.init({ routes: false })).rejects.toThrow(/needs the i18n option/);
    expect(contello.isReady).toBe(false);
  });

  test('ignores the i18n runtime options without an i18n collection', async () => {
    const { contello } = setup();

    await contello.init({ routes: false, i18n: i18nOptions });

    expect(mocks.configure).not.toHaveBeenCalled();
    expect(() => contello.i18nMessages).toThrow(/accessed before init/);

    await contello.destroy();
  });

  test('configures @astroscope/i18n with the i18n options only', async () => {
    const { contello } = setup({ i18n: true });

    await contello.init({ routes: false, i18n: { ...i18nOptions, register: false, load: false } });

    expect(mocks.configure).toHaveBeenCalledWith(i18nOptions);

    await contello.destroy();
  });

  test('pushes the translations of the collection for every configured locale', async () => {
    const { contello, fake } = setup({ i18n: true });

    await contello.init({ routes: false, i18n: i18nOptions });

    expect(fake.calls.find((call) => call.query.includes('contelloI18nMessagesBatch'))!.variables).toMatchObject({
      collection: 'website',
    });
    expect(mocks.setTranslations.mock.calls).toEqual([
      ['en', { 'home.title': 'Home' }],
      ['de', { 'home.title': 'Start' }],
    ]);
    expect(contello.i18nMessages).toBeDefined();

    await contello.destroy();
  });

  test('a locale without translations is set to none', async () => {
    const { contello, messages } = setup({ i18n: true });

    messages.entities.clear();

    await contello.init({ routes: false, i18n: i18nOptions });

    expect(mocks.setTranslations.mock.calls).toEqual([
      ['en', {}],
      ['de', {}],
    ]);

    await contello.destroy();
  });

  test('load: false pushes no translations', async () => {
    const { contello } = setup({ i18n: true });

    await contello.init({ routes: false, i18n: { ...i18nOptions, load: false } });

    expect(mocks.setTranslations).not.toHaveBeenCalled();

    await contello.destroy();
  });

  test('pushes the translations again when the collection refreshes, until destroy()', async () => {
    const { contello, messages } = setup({ i18n: true });

    await contello.init({ routes: false, i18n: i18nOptions });

    const collection = contello.i18nMessages;

    messages.entities.set('m1', message('m1', 'home.title', { en: 'Welcome' }));
    collection.refresh();

    await vi.waitFor(() => expect(translationsOf('en')).toEqual({ 'home.title': 'Welcome' }));
    expect(translationsOf('de')).toEqual({});

    await contello.destroy();

    const pushes = mocks.setTranslations.mock.calls.length;

    collection.refresh();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.setTranslations).toHaveBeenCalledTimes(pushes);
  });
});

describe('Contello.init i18n key registration', () => {
  const keys: ExtractedKey[] = [
    {
      key: 'cart.items',
      meta: {
        fallback: '{$count} items',
        description: 'cart size',
        variables: { count: { description: 'number of items', fallback: '3' }, plain: undefined },
      },
    },
    { key: 'home.title', meta: { fallback: 'Home' } },
  ];

  test('registers the extracted keys with their fallback as the default locale translation', async () => {
    const { contello, registrations } = setup({ i18n: true });

    mocks.manifestKeys.push(...keys);

    await contello.init({ routes: false, i18n: i18nOptions });

    expect(registrations).toEqual([
      {
        collection: 'website',
        messages: [
          {
            token: 'cart.items',
            example: '{$count} items',
            description: 'cart size',
            variables: [
              { name: 'count', description: 'number of items', example: '3' },
              { name: 'plain', description: '', example: '' },
            ],
            translations: undefined,
            initialTranslations: [{ language: 'en', message: '{$count} items' }],
          },
          {
            token: 'home.title',
            example: 'Home',
            description: '',
            variables: [],
            translations: undefined,
            initialTranslations: [{ language: 'en', message: 'Home' }],
          },
        ],
      },
    ]);

    await contello.destroy();
  });

  test('registers before it loads, so new keys are part of the first push', async () => {
    const { contello, fake } = setup({ i18n: true });

    mocks.manifestKeys.push(...keys);

    await contello.init({ routes: false, i18n: i18nOptions });

    const kinds = fake.calls.filter((call) => !call.query.includes('contelloUpdatesBatch')).map((call) => call.kind);

    expect(kinds).toEqual(['execute', 'subscribe']);

    await contello.destroy();
  });

  test('registers nothing in dev mode unless asked to', async () => {
    mocks.boot = { dev: true };
    mocks.manifestKeys.push(...keys);

    const quiet = setup({ i18n: true });

    await quiet.contello.init({ routes: false, i18n: i18nOptions });

    expect(quiet.registrations).toEqual([]);

    await quiet.contello.destroy();

    const asked = setup({ i18n: true });

    await asked.contello.init({ routes: false, i18n: { ...i18nOptions, register: true } });

    expect(asked.registrations).toHaveLength(1);

    await asked.contello.destroy();
  });

  test('register: false registers nothing', async () => {
    const { contello, registrations } = setup({ i18n: true });

    mocks.manifestKeys.push(...keys);

    await contello.init({ routes: false, i18n: { ...i18nOptions, register: false } });

    expect(registrations).toEqual([]);

    await contello.destroy();
  });

  test('sends no registration when no keys were extracted', async () => {
    const { contello, registrations } = setup({ i18n: true });

    await contello.init({ routes: false, i18n: i18nOptions });

    expect(registrations).toEqual([]);

    await contello.destroy();
  });
});

describe('Contello store proxies', () => {
  test('ping() and client go to the client of the store', async () => {
    const { contello, fake, ping } = setup();

    await contello.ping();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(contello.client).toBe(fake.client);
  });

  test('assets in every flavor read through the client', async () => {
    const asset = { id: 'a1', original: { uid: 'u1', mimeType: 'image/png', metadata: null }, preview: null, optimized: [] };

    mocks.client = createFakeContelloClient({ subscribe: () => ({ source: [asset] }) }).client;

    const contello = createContello(connection);
    const sync = contello.defineAssetsSync();

    await sync.load();

    expect(await contello.defineAssets().get('a1')).toMatchObject({ id: 'a1' });
    expect(sync.get('a1')).toMatchObject({ id: 'a1' });
    expect(await contello.defineLazyAssets().get('a1')).toMatchObject({ id: 'a1' });

    await contello.destroy();
  });

  test('collections and singletons read through the client', async () => {
    const entity = { document: '', fragment: 'Article', subscription: 'articlesBatch', __model: 'article', __cardinality: 'entity' } as const;
    const single = { document: '', fragment: 'Config', subscription: 'config', __model: 'config', __cardinality: 'singleton' } as const;

    mocks.client = createFakeContelloClient({
      subscribe(query) {
        if (query.includes('contelloRoutesBatch')) {
          return { source: [] };
        }

        return { source: query.includes('articlesBatch') ? [{ id: 'a', title: 'first' }] : { title: 'config' } };
      },
    }).client;

    const contello = createContello(connection);
    const collectionSync = contello.defineCollectionSync(entity);
    const singletonSync = contello.defineSingletonSync(single);

    await Promise.all([collectionSync.load(), singletonSync.load()]);

    expect(await contello.defineCollection(entity).get('a')).toEqual({ id: 'a', title: 'first' });
    expect(collectionSync.get('a')).toEqual({ id: 'a', title: 'first' });
    expect(await contello.defineLazyCollection(entity).get('a')).toEqual({ id: 'a', title: 'first' });
    expect(await contello.defineSingleton(single).get()).toEqual({ title: 'config' });
    expect(singletonSync.get()).toEqual({ title: 'config' });
    expect(await contello.defineRoutes().getByPath('/none')).toBeUndefined();

    await contello.destroy();
  });
});

describe('Contello middleware factories', () => {
  const passthrough = Symbol('passthrough');

  function request(pathname: string) {
    const ctx = {
      url: new URL(`https://tenant.example.com${pathname}`),
      request: { method: 'GET', signal: new AbortController().signal, headers: new Headers() },
    } as unknown as APIContext;
    const next = vi.fn(() => passthrough) as unknown as MiddlewareNext;

    return { ctx, next };
  }

  async function respond(middleware: MiddlewareHandler, pathname: string): Promise<string | typeof passthrough> {
    const { ctx, next } = request(pathname);
    const result = (await middleware(ctx, next)) as Response | typeof passthrough;

    return result === passthrough ? passthrough : result.text();
  }

  function setupRouting() {
    const context = setup();

    context.routes.entities.set('r2', {
      __typename: 'ContelloRoute',
      id: 'r2',
      path: '/tenant.example.com/home',
      customHeaders: [],
      target: { __typename: 'ContelloRouteTargetText', content: 'hello tenant', mimeType: 'text/plain' },
    });

    return context;
  }

  test('a routing middleware created before init() serves the routes init() brings', async () => {
    const { contello } = setupRouting();
    const middleware = contello.createRoutingMiddleware();

    await contello.init({ routes: 'sync' });

    expect(await respond(middleware, '/home')).toBe('hello');
    expect(await respond(middleware, '/unknown')).toBe(passthrough);

    await contello.destroy();
  });

  test('the routing middleware passes through when init() disabled the routes', async () => {
    const { contello } = setupRouting();
    const middleware = contello.createRoutingMiddleware();

    await contello.init({ routes: false });

    expect(await respond(middleware, '/home')).toBe(passthrough);

    await contello.destroy();
  });

  test('the route path resolver of init() applies, the one of the middleware wins', async () => {
    const { contello } = setupRouting();
    const byInit = contello.createRoutingMiddleware();
    const byMiddleware = contello.createRoutingMiddleware({ resolveRoutePath: () => '/home' });

    await contello.init({
      routes: 'sync',
      routing: { resolveRoutePath: (ctx) => `/${ctx.url.hostname}${ctx.url.pathname}` },
    });

    expect(await respond(byInit, '/home')).toBe('hello tenant');
    expect(await respond(byMiddleware, '/anything')).toBe('hello');

    await contello.destroy();
  });

  test('routes passed to the middleware win over the ones of init()', async () => {
    const { contello } = setupRouting();
    const own = {
      getByPath: () => ({ id: 'own', path: '/home', customHeaders: [], type: 'text', content: 'own', mimeType: 'text/plain' }),
    } as unknown as AnyRoutes;
    const middleware = contello.createRoutingMiddleware({ routes: own });

    await contello.init({ routes: false });

    expect(await respond(middleware, '/home')).toBe('own');

    await contello.destroy();
  });

  function setupAssets() {
    const context = setup();
    const download = vi.fn(async () => ({ mimeType: 'image/png', size: 3, stream: () => new Response('abc').body! }));

    (context.fake.client as unknown as { download: typeof download }).download = download;

    return { ...context, download };
  }

  async function cacheControlOf(middleware: MiddlewareHandler, pathname: string): Promise<string | null> {
    const { ctx, next } = request(pathname);
    const response = (await middleware(ctx, next)) as Response;

    return response.headers.get('cache-control');
  }

  test('an assets middleware created before init() takes the assets options init() brings', async () => {
    const { contello, download } = setupAssets();
    const middleware = contello.createAssetsMiddleware();

    await contello.init({ routes: false, assets: { images: { cacheControl: 'no-store' } } });

    expect(await respond(middleware, '/_contello/i/file-1.png')).toBe('abc');
    expect(download).toHaveBeenCalledWith('file-1');
    expect(await cacheControlOf(middleware, '/_contello/i/file-1.png')).toBe('no-store');

    await contello.destroy();
  });

  test('options passed to the assets middleware win over the ones of init()', async () => {
    const { contello } = setupAssets();
    const middleware = contello.createAssetsMiddleware({ images: { cacheControl: 'private' } });

    await contello.init({ routes: false, assets: false });

    expect(await cacheControlOf(middleware, '/_contello/i/file-1.png')).toBe('private');

    await contello.destroy();
  });

  test('the assets middleware passes through when init() disabled the assets', async () => {
    const { contello, download } = setupAssets();
    const middleware = contello.createAssetsMiddleware();

    await contello.init({ routes: false, assets: false });

    expect(await respond(middleware, '/_contello/i/file-1.png')).toBe(passthrough);
    expect(download).not.toHaveBeenCalled();

    await contello.destroy();
  });
});
