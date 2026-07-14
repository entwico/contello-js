import type { MediaAsset } from '@contello/media';
import { describe, expect, test } from 'vitest';

import { type ContelloRequestContext, createContello, runRequest } from './contello';

function makeContello(media?: { baseUrl?: string; imagesPath?: string; videosPath?: string; filesPath?: string }) {
  return createContello({
    url: 'http://localhost:9999',
    project: 'test-project',
    token: 'test-token',
    ...(media && { media }),
  });
}

function jpegAsset(id: string): MediaAsset {
  return {
    id,
    original: { uid: 'orig', mimeType: 'image/jpeg', metadata: { width: 800, height: 600 } },
    optimized: [{ uid: 'v1', mimeType: 'image/jpeg', metadata: { width: 800, height: 600 } }],
  };
}

describe('createContello media config', () => {
  test('applies default media prefixes', () => {
    const contello = makeContello();

    expect(contello.media).toEqual({
      baseUrl: '',
      imagesPath: '/_contello/i/',
      videosPath: '/_contello/v/',
      filesPath: '/_contello/f/',
    });
  });

  test('honors partial media overrides while keeping defaults for the rest', () => {
    const contello = makeContello({ baseUrl: 'https://cdn.example.com', imagesPath: '/img/' });

    expect(contello.media.baseUrl).toBe('https://cdn.example.com');
    expect(contello.media.imagesPath).toBe('/img/');
    expect(contello.media.videosPath).toBe('/_contello/v/');
    expect(contello.media.filesPath).toBe('/_contello/f/');
  });
});

describe('Contello.isReady', () => {
  test('is false before init()', () => {
    expect(makeContello().isReady).toBe(false);
  });
});

describe('Contello.defineMediaResolver', () => {
  test('builds urls from the configured base url and image prefix', () => {
    const contello = makeContello({ baseUrl: 'https://cdn.example.com', imagesPath: '/img/' });
    const resolver = contello.defineMediaResolver();

    expect(resolver.image.url(jpegAsset('a'), 'web')).toBe('https://cdn.example.com/img/v1.jpg');
  });

  test('per-call options override the inherited media config', () => {
    const contello = makeContello({ baseUrl: 'https://cdn.example.com', imagesPath: '/img/' });
    const resolver = contello.defineMediaResolver({ imagesPath: '/other/' });

    expect(resolver.image.url(jpegAsset('a'), 'web')).toBe('https://cdn.example.com/other/v1.jpg');
  });

  test('substitutes a configured fallback for a missing source', () => {
    const contello = makeContello();
    const resolver = contello.defineMediaResolver({
      fallback: { src: '/fallback.jpg', format: 'jpeg', width: 100, height: 100 },
    });
    const source = resolver.image.source(null);

    expect(source.fallback).toBe(true);
    expect(source.image!.url).toBe('/fallback.jpg');
  });
});

describe('Contello request context', () => {
  test('request throws when accessed outside of a request scope', () => {
    expect(() => makeContello().request).toThrow(/outside of request context/);
  });

  test('runRequest exposes the active context via request', () => {
    const contello = makeContello();
    const ctx: ContelloRequestContext = {
      url: new URL('https://example.com/page'),
      route: undefined,
      rewritten: false,
    };

    const seen = contello[runRequest](ctx, () => contello.request);

    expect(seen).toBe(ctx);
  });

  test('request contexts nest and restore across runRequest scopes', () => {
    const contello = makeContello();
    const outer: ContelloRequestContext = {
      url: new URL('https://example.com/outer'),
      route: undefined,
      rewritten: false,
    };
    const inner: ContelloRequestContext = {
      url: new URL('https://example.com/inner'),
      route: undefined,
      rewritten: true,
    };

    const result = contello[runRequest](outer, () => {
      const innerSeen = contello[runRequest](inner, () => contello.request);

      return { innerSeen, afterInner: contello.request };
    });

    expect(result.innerSeen).toBe(inner);
    expect(result.afterInner).toBe(outer);
  });
});

describe('Contello accessors before init', () => {
  test('i18nMessages throws before init with i18n config', () => {
    expect(() => makeContello().i18nMessages).toThrow(/accessed before init/);
  });

  test('client is available without connecting', () => {
    expect(makeContello().client).toBeDefined();
  });
});

describe('Contello middleware factories', () => {
  test('createRoutingMiddleware returns a middleware function', () => {
    const mw = makeContello().createRoutingMiddleware();

    expect(typeof mw).toBe('function');
  });

  test('createAssetsMiddleware returns a middleware function', () => {
    const mw = makeContello().createAssetsMiddleware();

    expect(typeof mw).toBe('function');
  });
});
