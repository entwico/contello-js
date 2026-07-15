import type { APIContext, MiddlewareNext } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createBoundAssetsMiddleware } from './assets-middleware';
import type { Contello } from './contello';

const mocks = vi.hoisted(() => ({
  overrideRequestRoute: vi.fn(),
}));

vi.mock('@astroscope/node/log', () => ({
  overrideRequestRoute: mocks.overrideRequestRoute,
}));

type DownloadResult = { mimeType: string; size: number; stream: () => ReadableStream };
type HlsResult = { status: number; headers: Headers; stream: () => ReadableStream };

type FakeClient = {
  download: ReturnType<typeof vi.fn>;
  proxyHls: ReturnType<typeof vi.fn>;
};

function fakeContello(options?: {
  isReady?: boolean;
  download?: () => Promise<DownloadResult>;
  proxyHls?: () => Promise<HlsResult>;
}): { instance: Contello<any>; client: FakeClient } {
  const client: FakeClient = {
    download: vi.fn(
      options?.download ??
      (async (): Promise<DownloadResult> => ({
        mimeType: 'image/png',
        size: 4,
        stream: () => new Response('data').body!,
      })),
    ),
    proxyHls: vi.fn(
      options?.proxyHls ??
      (async (): Promise<HlsResult> => ({
        status: 200,
        headers: new Headers({ 'content-type': 'application/vnd.apple.mpegurl' }),
        stream: () => new Response('#EXTM3U').body!,
      })),
    ),
  };

  const instance = {
    isReady: options?.isReady ?? true,
    client,
    media: {
      baseUrl: '',
      imagesPath: '/_contello/i/',
      filesPath: '/_contello/f/',
      videosPath: '/_contello/v/',
    },
  } as unknown as Contello<any>;

  return { instance, client };
}

function fakeCtx(pathname: string): APIContext {
  return {
    url: new URL(`https://example.com${pathname}`),
    request: { method: 'GET', signal: new AbortController().signal },
  } as unknown as APIContext;
}

const passthrough = Symbol('passthrough');

type NextMock = ReturnType<typeof vi.fn> & MiddlewareNext;

function fakeNext(): NextMock {
  return vi.fn(() => passthrough as unknown as Response) as unknown as NextMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.overrideRequestRoute.mockClear();
});

describe('createBoundAssetsMiddleware', () => {
  test('passes through paths outside the media prefixes', () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/about'), next);

    expect(result).toBe(passthrough);
    expect(client.download).not.toHaveBeenCalled();
    expect(client.proxyHls).not.toHaveBeenCalled();
  });

  test('passes through with a warning when not initialized', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { instance } = fakeContello({ isReady: false });
    const mw = createBoundAssetsMiddleware(instance, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/_contello/i/abc.png'), next);

    expect(result).toBe(passthrough);
    expect(warn).toHaveBeenCalledOnce();
  });

  test('serves an image by downloading the id and applying the default cache-control', async () => {
    const { instance, client } = fakeContello({
      download: async () => ({ mimeType: 'image/jpeg', size: 200, stream: () => new Response('img').body! }),
    });
    const mw = createBoundAssetsMiddleware(instance, undefined);

    const response = (await mw(fakeCtx('/_contello/i/abc.jpg'), fakeNext())) as Response;

    expect(client.download).toHaveBeenCalledWith('abc');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000');
    expect(response.headers.get('content-length')).toBe('200');
  });

  test('honors a custom image cache-control', async () => {
    const { instance } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, { images: { cacheControl: 'no-store' } });

    const response = (await mw(fakeCtx('/_contello/i/abc.png'), fakeNext())) as Response;

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('strips the extension after the first dot to derive the file id', async () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);

    await mw(fakeCtx('/_contello/i/abc.def.png'), fakeNext());

    expect(client.download).toHaveBeenCalledWith('abc');
  });

  test('uses the whole segment as the file id when there is no extension', async () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);

    await mw(fakeCtx('/_contello/i/no-extension-id'), fakeNext());

    expect(client.download).toHaveBeenCalledWith('no-extension-id');
  });

  test('serves a file without a cache-control header by default', async () => {
    const { instance, client } = fakeContello({
      download: async () => ({ mimeType: 'application/pdf', size: 0, stream: () => new Response('pdf').body! }),
    });
    const mw = createBoundAssetsMiddleware(instance, undefined);

    const response = (await mw(fakeCtx('/_contello/f/file-1.pdf'), fakeNext())) as Response;

    expect(client.download).toHaveBeenCalledWith('file-1');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
  });

  test('serves an HLS video through proxyHls with the request signal', async () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);

    const response = (await mw(fakeCtx('/_contello/v/vid/master.m3u8'), fakeNext())) as Response;

    expect(client.proxyHls).toHaveBeenCalledWith('vid/master.m3u8', expect.any(AbortSignal));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
  });

  test('passes through when the image id resolves to empty', () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/_contello/i/.png'), next);

    expect(result).toBe(passthrough);
    expect(client.download).not.toHaveBeenCalled();
  });

  test('passes through when the video path is empty', () => {
    const { instance, client } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);
    const next = fakeNext();

    const result = mw(fakeCtx('/_contello/v/'), next);

    expect(result).toBe(passthrough);
    expect(client.proxyHls).not.toHaveBeenCalled();
  });

  test('answers with 404 when a file download throws', async () => {
    const { instance } = fakeContello({
      download: async () => {
        throw new Error('missing');
      },
    });
    const mw = createBoundAssetsMiddleware(instance, undefined);

    const response = (await mw(fakeCtx('/_contello/i/gone.png'), fakeNext())) as Response;

    expect(response.status).toBe(404);
  });

  test('answers with 502 when the HLS upstream throws', async () => {
    const { instance } = fakeContello({
      proxyHls: async () => {
        throw new Error('upstream down');
      },
    });
    const mw = createBoundAssetsMiddleware(instance, undefined);

    const response = (await mw(fakeCtx('/_contello/v/vid/master.m3u8'), fakeNext())) as Response;

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('text/plain');
    await expect(response.text()).resolves.toBe('Upstream is down');
  });
});

describe('createBoundAssetsMiddleware route reporting', () => {
  test.each([
    ['/_contello/i/abc.png', '/_contello/i/[file]'],
    ['/_contello/f/doc.pdf', '/_contello/f/[file]'],
    ['/_contello/v/vid/master.m3u8', '/_contello/v/[...path]'],
  ])('reports %s as a templated label carrying no asset id', async (pathname, label) => {
    const { instance } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);

    await mw(fakeCtx(pathname), fakeNext());

    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith(label);
  });

  test('templates the label on the configured prefix', async () => {
    const { instance } = fakeContello();

    (instance as unknown as { media: { imagesPath: string } }).media.imagesPath = '/img/';

    const mw = createBoundAssetsMiddleware(instance, undefined);

    await mw(fakeCtx('/img/abc.png'), fakeNext());

    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith('/img/[file]');
  });

  test('reports the route even when the asset fails to download', async () => {
    const { instance } = fakeContello({
      download: async () => {
        throw new Error('gone');
      },
    });
    const mw = createBoundAssetsMiddleware(instance, undefined);

    await mw(fakeCtx('/_contello/i/gone.png'), fakeNext());

    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith('/_contello/i/[file]');
  });

  test.each([
    ['a path contello does not serve', '/some/page'],
    ['a bare prefix with no asset id', '/_contello/i/'],
  ])('leaves the route alone for %s', (_name, pathname) => {
    const { instance } = fakeContello();
    const mw = createBoundAssetsMiddleware(instance, undefined);

    mw(fakeCtx(pathname), fakeNext());

    expect(mocks.overrideRequestRoute).not.toHaveBeenCalled();
  });
});
