import type { StoreRoute } from '@contello/store';
import type { MaybePromise } from '@entwico/dash';
import type { APIContext, MiddlewareNext } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { type Contello, runRequest } from './contello';
import { type AnyRoutes, createBoundRoutingMiddleware } from './routing-middleware';

const mocks = vi.hoisted(() => ({
  overrideRequestRoute: vi.fn(),
}));

vi.mock('@astroscope/node/log', () => ({
  overrideRequestRoute: mocks.overrideRequestRoute,
}));

type DownloadResult = {
  mimeType: string;
  size: number;
  stream: () => ReadableStream;
};

type FakeContello = {
  instance: Contello<any>;
  contexts: unknown[];
  download: ReturnType<typeof vi.fn>;
};

function fakeContello(overrides?: { isReady?: boolean; download?: () => Promise<DownloadResult> }): FakeContello {
  const contexts: unknown[] = [];
  const download = vi.fn(
    overrides?.download ??
    (async (): Promise<DownloadResult> => ({
      mimeType: 'image/png',
      size: 3,
      stream: () => new Response('abc').body!,
    })),
  );

  const instance = {
    isReady: overrides?.isReady ?? true,
    client: { download },
    [runRequest]<T>(ctx: unknown, fn: () => T): T {
      contexts.push(ctx);

      return fn();
    },
  } as unknown as Contello<any>;

  return { instance, contexts, download };
}

function fakeRoutes(byPath: Record<string, MaybePromise<StoreRoute | undefined>>): AnyRoutes {
  return {
    getByPath: (path: string) => byPath[path],
  } as unknown as AnyRoutes;
}

function fakeCtx(pathname: string, method = 'GET'): APIContext {
  return {
    url: new URL(`https://example.com${pathname}`),
    request: { method, signal: new AbortController().signal },
  } as unknown as APIContext;
}

const passthrough = Symbol('passthrough');

type NextMock = ReturnType<typeof vi.fn> & MiddlewareNext;

function fakeNext(): NextMock {
  return vi.fn((path?: string) =>
    path === undefined ? (passthrough as unknown) : new Response('entity-body'),
  ) as unknown as NextMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.overrideRequestRoute.mockClear();
});

describe('createBoundRoutingMiddleware', () => {
  test('passes excluded paths straight through without consulting routes', () => {
    const { instance, contexts } = fakeContello();
    const routes = fakeRoutes({});
    const getByPath = vi.spyOn(routes, 'getByPath');
    const mw = createBoundRoutingMiddleware(instance, routes, undefined, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/_astro/app.js'), next);

    expect(result).toBe(passthrough);
    expect(next).toHaveBeenCalledOnce();
    expect(getByPath).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  test('passes through with a warning when not initialized', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { instance } = fakeContello({ isReady: false });
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({}), undefined, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/some/page'), next);

    expect(result).toBe(passthrough);
    expect(warn).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  test('routes /contello/entities/ paths through the request context without a route', () => {
    const { instance, contexts } = fakeContello();
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({}), undefined, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/contello/entities/article/42'), next);

    expect(result).toBe(passthrough);
    expect(contexts).toEqual([
      { url: expect.any(URL), route: undefined, rewritten: false },
    ]);
  });

  test('unknown path runs through the request context with no route and passes through', () => {
    const { instance, contexts } = fakeContello();
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({}), undefined, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/nope'), next);

    expect(result).toBe(passthrough);
    expect(contexts).toHaveLength(1);
    expect((contexts[0] as { route: unknown }).route).toBeUndefined();
  });

  test('resolves a redirect route into a Response with Location and custom headers', async () => {
    const { instance } = fakeContello();
    const route: StoreRoute = {
      id: 'r1',
      path: '/old',
      customHeaders: [{ name: 'X-Reason', value: 'moved' }],
      type: 'redirect',
      location: '/new',
      status: 301,
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/old': route }), undefined, undefined);

    const response = (await mw(fakeCtx('/old'), fakeNext())) as Response;

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/new');
    expect(response.headers.get('X-Reason')).toBe('moved');
  });

  test('coerces an invalid redirect status to 302', async () => {
    const { instance } = fakeContello();
    const route: StoreRoute = {
      id: 'r1',
      path: '/old',
      customHeaders: [],
      type: 'redirect',
      location: '/new',
      status: 999,
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/old': route }), undefined, undefined);

    const response = (await mw(fakeCtx('/old'), fakeNext())) as Response;

    expect(response.status).toBe(302);
  });

  test('resolves a text route into a Response carrying content and mime type', async () => {
    const { instance } = fakeContello();
    const route: StoreRoute = {
      id: 'r2',
      path: '/robots.txt',
      customHeaders: [{ name: 'X-Meta', value: '1' }],
      type: 'text',
      content: 'User-agent: *',
      mimeType: 'text/plain',
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/robots.txt': route }), undefined, undefined);

    const response = (await mw(fakeCtx('/robots.txt'), fakeNext())) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('X-Meta')).toBe('1');
    await expect(response.text()).resolves.toBe('User-agent: *');
  });

  test('resolves an asset route by downloading the file and setting content headers', async () => {
    const { instance, download } = fakeContello({
      download: async () => ({ mimeType: 'application/pdf', size: 128, stream: () => new Response('pdf').body! }),
    });
    const route: StoreRoute = {
      id: 'r3',
      path: '/doc.pdf',
      customHeaders: [{ name: 'X-Doc', value: 'yes' }],
      type: 'asset',
      assetId: 'asset-1',
      fileId: 'file-1',
      contentDisposition: 'attachment',
      mimeType: 'application/pdf',
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/doc.pdf': route }), undefined, undefined);

    const response = (await mw(fakeCtx('/doc.pdf'), fakeNext())) as Response;

    expect(download).toHaveBeenCalledWith('file-1');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('content-length')).toBe('128');
    expect(response.headers.get('X-Doc')).toBe('yes');
  });

  test('asset route falls back to the download mime type when the route omits one', async () => {
    const { instance } = fakeContello({
      download: async () => ({ mimeType: 'image/webp', size: 0, stream: () => new Response('x').body! }),
    });
    const route: StoreRoute = {
      id: 'r4',
      path: '/img',
      customHeaders: [],
      type: 'asset',
      assetId: 'a',
      fileId: 'f',
      contentDisposition: 'inline',
      mimeType: '',
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/img': route }), undefined, undefined);

    const response = (await mw(fakeCtx('/img'), fakeNext())) as Response;

    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-length')).toBeNull();
  });

  test('rewrites an entity route to the internal entities path and propagates custom headers', async () => {
    const { instance, contexts } = fakeContello();
    const route: StoreRoute = {
      id: 'r5',
      path: '/articles/hello',
      customHeaders: [{ name: 'X-Entity', value: 'article' }],
      type: 'entity',
      model: 'article',
      entityType: 'ArticleEntity',
      entityId: 'e-99',
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/articles/hello': route }), undefined, undefined);
    const next = fakeNext();

    const response = (await mw(fakeCtx('/articles/hello?preview=1'), next)) as Response;

    expect(next).toHaveBeenCalledWith('/contello/entities/article/e-99?preview=1');
    expect(response.headers.get('X-Entity')).toBe('article');
    expect((contexts[0] as { rewritten: boolean }).rewritten).toBe(true);
  });

  test('uses ctx.url.pathname for the route lookup by default', () => {
    const { instance } = fakeContello();
    const routes = fakeRoutes({});
    const getByPath = vi.spyOn(routes, 'getByPath');
    const mw = createBoundRoutingMiddleware(instance, routes, undefined, undefined);

    mw(fakeCtx('/lookup/me'), fakeNext());

    expect(getByPath).toHaveBeenCalledWith('/lookup/me');
  });

  test('uses a custom resolveRoutePath when provided', () => {
    const { instance } = fakeContello();
    const routes = fakeRoutes({});
    const getByPath = vi.spyOn(routes, 'getByPath');
    const resolveRoutePath = (ctx: APIContext) => `/${ctx.url.hostname}${ctx.url.pathname}`;
    const mw = createBoundRoutingMiddleware(instance, routes, undefined, resolveRoutePath);

    mw(fakeCtx('/tenant/page'), fakeNext());

    expect(getByPath).toHaveBeenCalledWith('/example.com/tenant/page');
  });

  test('awaits an async getByPath result before resolving the route', async () => {
    const { instance } = fakeContello();
    const route: StoreRoute = {
      id: 'r6',
      path: '/async',
      customHeaders: [],
      type: 'text',
      content: 'hi',
      mimeType: 'text/plain',
    };
    const mw = createBoundRoutingMiddleware(
      instance,
      fakeRoutes({ '/async': Promise.resolve(route) }),
      undefined,
      undefined,
    );

    const response = (await mw(fakeCtx('/async'), fakeNext())) as Response;

    await expect(response.text()).resolves.toBe('hi');
  });

  test('honors a custom exclude list over the recommended defaults', () => {
    const { instance } = fakeContello();
    const routes = fakeRoutes({});
    const getByPath = vi.spyOn(routes, 'getByPath');
    const mw = createBoundRoutingMiddleware(instance, routes, [{ prefix: '/skip/' }], undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/skip/here'), next);

    expect(result).toBe(passthrough);
    expect(getByPath).not.toHaveBeenCalled();
  });
});

describe('createBoundRoutingMiddleware route reporting', () => {
  test('reports an entity route templated on the model, without the entity id', async () => {
    const { instance } = fakeContello();
    const route: StoreRoute = {
      id: 'r1',
      path: '/articles/hello',
      customHeaders: [],
      type: 'entity',
      model: 'article',
      entityType: 'ArticleEntity',
      entityId: 'e-99',
    };
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/articles/hello': route }), undefined, undefined);

    await mw(fakeCtx('/articles/hello'), fakeNext());

    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith('/contello/entities/article/[id]');
  });

  test.each([
    ['redirect', { type: 'redirect', location: '/new', status: 301 }],
    ['text', { type: 'text', content: 'hi', mimeType: 'text/plain' }],
    ['asset', { type: 'asset', assetId: 'a', fileId: 'f', contentDisposition: 'inline', mimeType: 'image/png' }],
  ])('reports a %s route as its own label', async (type, rest) => {
    const { instance } = fakeContello();
    const route = { id: 'r1', path: '/p', customHeaders: [], ...rest } as StoreRoute;
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({ '/p': route }), undefined, undefined);

    await mw(fakeCtx('/p'), fakeNext());

    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith(`contello:route:${type}`);
  });

  test('leaves the route alone when no contello route matches', () => {
    const { instance } = fakeContello();
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({}), undefined, undefined);

    mw(fakeCtx('/nope'), fakeNext());

    expect(mocks.overrideRequestRoute).not.toHaveBeenCalled();
  });

  test('leaves the route alone for excluded paths', () => {
    const { instance } = fakeContello();
    const mw = createBoundRoutingMiddleware(instance, fakeRoutes({}), undefined, undefined);

    mw(fakeCtx('/_astro/app.js'), fakeNext());

    expect(mocks.overrideRequestRoute).not.toHaveBeenCalled();
  });
});
