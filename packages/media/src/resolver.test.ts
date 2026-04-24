import { describe, expect, expectTypeOf, test } from 'vitest';

import { type MediaResolverOptions, createMediaResolver } from './resolver';
import type { ImageDef, MediaAsset } from './types';

const baseUrl = 'https://cdn.example.com';

const testPaths = { imagesPath: '/i/', videosPath: '/v/' } satisfies Partial<MediaResolverOptions>;

function asset(partial: Partial<MediaAsset> & Pick<MediaAsset, 'id'>): MediaAsset {
  return {
    original: { uid: 'orig-uid', mimeType: 'image/jpeg', metadata: { width: 4000, height: 3000 } },
    optimized: [],
    ...partial,
  };
}

const fallbackImage: ImageDef = {
  id: 'fallback',
  variants: [{ type: 'image/jpeg', url: '/fallback.jpg', width: 100, height: 100 }],
};

// URL construction is verified indirectly through `image.def` / `file.def` /
// `video.m3u8` — the only observable output surfaces consumers see.
describe('MediaResolver URL construction', () => {
  // uses a MediaAsset with one jpeg variant in `optimized` so image.def produces
  // a single ImageDef variant whose url exercises baseUrl + imagesPath + extension
  const jpegAsset = (uid: string) =>
    asset({
      id: 'a',
      optimized: [{ uid, mimeType: 'image/jpeg', metadata: { width: 100, height: 100 } }],
    });

  test.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/svg+xml', 'svg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/avif', 'avif'],
  ])('appends .%s extension for %s variants', (mime, ext) => {
    const media = createMediaResolver({ baseUrl, ...testPaths });
    const def = media.image.def(
      asset({ id: 'a', optimized: [{ uid: 'abc', mimeType: mime, metadata: { width: 1, height: 1 } }] }),
    );

    expect(def.variants[0]!.url).toBe(`${baseUrl}/i/abc.${ext}`);
  });

  test('omits extension for unknown mime types (via file.def)', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, filesPath: '/f/' });
    const def = media.file.def(
      asset({ id: 'f', original: { uid: 'abc', mimeType: 'application/x-weird', metadata: null } }),
    );

    expect(def.url).toBe(`${baseUrl}/f/abc`);
  });

  test('strips trailing slash from baseUrl', () => {
    const m = createMediaResolver({ baseUrl: `${baseUrl}/`, ...testPaths });
    const def = m.image.def(jpegAsset('x'));

    expect(def.variants[0]!.url).toBe(`${baseUrl}/i/x.jpg`);
  });

  test('honors custom imagesPath (for proxied setups)', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '/_contello/i/' });
    const def = m.image.def(jpegAsset('abc'));

    expect(def.variants[0]!.url).toBe('/_contello/i/abc.jpg');
  });

  test('honors custom videosPath via video.m3u8', () => {
    const m = createMediaResolver({ baseUrl: '', videosPath: '/_contello/v/' });

    expect(
      m.video.m3u8({ id: 'vid', original: { uid: 'v', mimeType: 'video/mp4', metadata: null }, optimized: [] }),
    ).toBe('/_contello/v/vid/master.m3u8');
  });

  test('normalizes imagesPath to ensure leading + trailing slash', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '_contello/i' });
    const def = m.image.def(jpegAsset('x'));

    expect(def.variants[0]!.url).toBe('/_contello/i/x.jpg');
  });

  test('filesPath is separate from imagesPath (file.def uses filesPath)', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '/i/', filesPath: '/f/' });
    const imageDef = m.image.def(jpegAsset('img'));
    const fileDef = m.file.def(
      asset({ id: 'f', original: { uid: 'file-uid', mimeType: 'application/pdf', metadata: null } }),
    );

    expect(imageDef.variants[0]!.url).toBe('/i/img.jpg');
    expect(fileDef.url).toBe('/f/file-uid.pdf');
  });
});

describe('MediaResolver.image.def', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('builds an ImageDef from a MediaAsset with optimized variants', () => {
    const def = media.image.def(
      asset({
        id: 'a',
        optimized: [
          { uid: 'w1', mimeType: 'image/webp', metadata: { width: 800, height: 600 } },
          { uid: 'a1', mimeType: 'image/avif', metadata: { width: 800, height: 600 } },
        ],
      }),
    );

    expect(def.id).toBe('a');
    expect(def.variants).toHaveLength(2);
    expect(def.variants[0]!.url).toBe(`${baseUrl}/i/w1.webp`);
  });

  test('includes preview as an additional variant alongside optimized', () => {
    const def = media.image.def(
      asset({
        id: 'a',
        preview: { uid: 'p', mimeType: 'image/jpeg', metadata: { width: 1000, height: 750 } },
        optimized: [
          { uid: 'w1', mimeType: 'image/webp', metadata: { width: 800, height: 600 } },
          { uid: 'j1', mimeType: 'image/jpeg', metadata: { width: 1600, height: 1200 } },
        ],
      }),
    );

    expect(def.variants).toHaveLength(3);
    const urls = def.variants.map((v) => v.url);

    expect(urls).toContain(`${baseUrl}/i/w1.webp`);
    expect(urls).toContain(`${baseUrl}/i/j1.jpg`);
    expect(urls).toContain(`${baseUrl}/i/p.jpg`);
  });

  test('SVG original bypasses optimized variants and uses the original directly', () => {
    const def = media.image.def(
      asset({
        id: 'a',
        original: { uid: 'svg', mimeType: 'image/svg+xml', metadata: { width: 200, height: 200 } },
        optimized: [{ uid: 'w1', mimeType: 'image/webp', metadata: { width: 800, height: 600 } }],
      }),
    );

    expect(def.variants).toHaveLength(1);
    expect(def.variants[0]!.type).toBe('image/svg+xml');
    expect(def.variants[0]!.url).toBe(`${baseUrl}/i/svg.svg`);
  });

  test('preview alone forms the only variant when optimized has no metadata', () => {
    const def = media.image.def(
      asset({
        id: 'a',
        preview: { uid: 'p', mimeType: 'image/jpeg', metadata: { width: 100, height: 100 } },
        optimized: [{ uid: 'w1', mimeType: 'image/webp', metadata: null }],
      }),
    );

    expect(def.variants).toHaveLength(1);
    expect(def.variants[0]!.url).toBe(`${baseUrl}/i/p.jpg`);
  });

  test('returns undefined for null source when no fallback configured', () => {
    expect(media.image.def(null)).toBeUndefined();
    expect(media.image.def(undefined)).toBeUndefined();
  });

  test('per-call fallback wins when source is null', () => {
    expect(media.image.def(null, fallbackImage)).toBe(fallbackImage);
  });

  test('init-time fallback wins when source is null (narrows return type)', () => {
    const m = createMediaResolver({ baseUrl, fallback: fallbackImage, ...testPaths });

    const def = m.image.def(null);

    expect(def).toBe(fallbackImage);
    expectTypeOf(def).toEqualTypeOf<ImageDef>();
  });

  test('per-call fallback takes precedence over init-time fallback', () => {
    const initFallback: ImageDef = { id: 'init', variants: [] };
    const perCall: ImageDef = { id: 'per', variants: [] };
    const m = createMediaResolver({ baseUrl, fallback: initFallback, ...testPaths });

    expect(m.image.def(null, perCall)).toBe(perCall);
  });

  test('type narrowing: non-null source returns ImageDef unconditionally', () => {
    const def = media.image.def(asset({ id: 'a' }));

    expectTypeOf(def).toEqualTypeOf<ImageDef>();
  });

  test('type narrowing: explicit per-call fallback returns ImageDef', () => {
    const def = media.image.def(null as MediaAsset | null, fallbackImage);

    expectTypeOf(def).toEqualTypeOf<ImageDef>();
  });

  test('type: nullable source without fallback and without init default returns ImageDef | undefined', () => {
    const def = media.image.def(null as MediaAsset | null);

    expectTypeOf(def).toEqualTypeOf<ImageDef | undefined>();
  });
});

describe('MediaResolver.image.url', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  const imageDef: ImageDef = {
    id: 'x',
    variants: [
      { type: 'image/webp', url: '/w-400', width: 400, height: 300 },
      { type: 'image/webp', url: '/w-800', width: 800, height: 600 },
      { type: 'image/webp', url: '/w-1200', width: 1200, height: 900 },
      { type: 'image/jpeg', url: '/j-400', width: 400, height: 300 },
      { type: 'image/jpeg', url: '/j-800', width: 800, height: 600 },
      { type: 'image/jpeg', url: '/j-1200', width: 1200, height: 900 },
    ],
  };

  test('picks highest-priority format; smallest-width wins within tier', () => {
    expect(media.image.url(imageDef, 'web')).toBe('/w-400');
  });

  test('respects minWidth: smallest variant that meets threshold', () => {
    expect(media.image.url(imageDef, 'web', { minWidth: 600 })).toBe('/w-800');
  });

  test('respects maxWidth: smallest within bounds', () => {
    expect(media.image.url(imageDef, 'web', { maxWidth: 800 })).toBe('/w-400');
  });

  test('og preset applies built-in minWidth/maxWidth (600-1200)', () => {
    expect(media.image.url(imageDef, 'og')).toBe('/j-800');
  });

  test('email preset prefers jpeg over webp', () => {
    expect(media.image.url(imageDef, 'email')).toBe('/j-400');
  });

  test('returns empty string for null source with no fallback', () => {
    expect(media.image.url(null, 'web')).toBe('');
  });

  test('per-call fallback applies when source is null', () => {
    expect(media.image.url(null, 'web', { fallback: fallbackImage })).toBe('/fallback.jpg');
  });

  test('accepts MediaAsset as source (auto-converts to ImageDef)', () => {
    const url = media.image.url(
      asset({
        id: 'a',
        optimized: [{ uid: 'abc', mimeType: 'image/webp', metadata: { width: 800, height: 600 } }],
      }),
      'web',
    );

    expect(url).toBe(`${baseUrl}/i/abc.webp`);
  });
});

describe('MediaResolver.picture.src', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  const imageDef: ImageDef = {
    id: 'x',
    variants: [
      { type: 'image/avif', url: '/a-400', width: 400, height: 300 },
      { type: 'image/avif', url: '/a-800', width: 800, height: 600 },
      { type: 'image/webp', url: '/w-400', width: 400, height: 300 },
      { type: 'image/webp', url: '/w-800', width: 800, height: 600 },
      { type: 'image/jpeg', url: '/j-400', width: 400, height: 300 },
      { type: 'image/jpeg', url: '/j-800', width: 800, height: 600 },
    ],
  };

  test('emits one <source> per default format (avif, webp)', () => {
    const data = media.picture.src(imageDef);

    expect(data.sources).toHaveLength(2);
    expect(data.sources!.map((s) => s.type)).toEqual(['image/avif', 'image/webp']);
  });

  test('each <source> srcset lists widths of that format ascending', () => {
    const data = media.picture.src(imageDef);

    expect(data.sources![0]!.srcset).toBe('/a-400 400w, /a-800 800w');
  });

  test('<img> fallback picks legacy format (jpeg) and multi-variant srcset is emitted', () => {
    const data = media.picture.src(imageDef);

    // main variant is jpeg (legacy-first fallback priority); jpeg has 2 variants so srcset appears
    expect(data.image!.srcset).toBe('/j-400 400w, /j-800 800w');
    expect(data.image!.url).toBe('/j-800'); // pickByPriority picks largest within the chosen format
  });

  test('converts sourceWidth into a sizes string, largest breakpoint first', () => {
    const data = media.picture.src(imageDef, { sourceWidth: { md: 400, lg: 800 } });

    expect(data.image!.sizes).toBe('(min-width: 1024px) 800px, (min-width: 768px) 400px, 100vw');
  });

  test('omits sizes on image when sourceWidth is not provided (default 100vw is implicit)', () => {
    const data = media.picture.src(imageDef);

    expect(data.image!.sizes).toBeUndefined();
  });

  test('omits srcset on image when there is only a single main-format variant', () => {
    const singleVariant: ImageDef = {
      id: 'x',
      variants: [{ type: 'image/jpeg', url: '/only', width: 400, height: 300 }],
    };
    const data = media.picture.src(singleVariant);

    expect(data.image!.srcset).toBeUndefined();
    expect(data.image!.url).toBe('/only');
  });

  test('omits width/height on image when source variant dimensions are zero', () => {
    const noMeta: ImageDef = {
      id: 'x',
      variants: [{ type: 'image/jpeg', url: '/x', width: 0, height: 0 }],
    };
    const data = media.picture.src(noMeta);

    expect(data.image!.width).toBeUndefined();
    expect(data.image!.height).toBeUndefined();
  });

  test('omits sources when no matching format variants exist', () => {
    const onlyJpeg: ImageDef = {
      id: 'x',
      variants: [{ type: 'image/jpeg', url: '/x', width: 400, height: 300 }],
    };
    const data = media.picture.src(onlyJpeg, { formats: ['image/avif', 'image/webp'] });

    expect(data.sources).toBeUndefined();
  });

  test('returns empty object for null source with no fallback', () => {
    const data = media.picture.src(null);

    expect(data).toEqual({});
  });

  test('per-call fallback applies when source is null', () => {
    const data = media.picture.src(null, { fallback: fallbackImage });

    expect(data.id).toBe('fallback');
  });

  test('accepts MediaAsset as source', () => {
    const data = media.picture.src(
      asset({
        id: 'a',
        optimized: [
          { uid: 'abc', mimeType: 'image/webp', metadata: { width: 800, height: 600 } },
          { uid: 'def', mimeType: 'image/webp', metadata: { width: 1200, height: 900 } },
        ],
      }),
    );

    expect(data.id).toBe('a');
    expect(data.sources).toHaveLength(1);
  });

  test('custom formats override default', () => {
    const data = media.picture.src(imageDef, { formats: ['image/webp'] });

    expect(data.sources).toHaveLength(1);
    expect(data.sources![0]!.type).toBe('image/webp');
  });

  test('skips formats with no matching variants', () => {
    const data = media.picture.src(imageDef, { formats: ['image/avif', 'image/heic'] });

    expect(data.sources!.map((s) => s.type)).toEqual(['image/avif']);
  });
});

describe('MediaResolver.video', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('def() builds VideoDef with m3u8 URL + dimensions', () => {
    const def = media.video.def(
      asset({
        id: 'vid',
        original: { uid: 'v', mimeType: 'video/mp4', metadata: { width: 1920, height: 1080 } },
      }),
    );

    expect(def).toEqual({
      id: 'vid',
      url: `${baseUrl}/v/vid/master.m3u8`,
      width: 1920,
      height: 1080,
    });
  });

  test('def() defaults dimensions to 0 when metadata is missing', () => {
    const def = media.video.def(asset({ id: 'vid', original: { uid: 'v', mimeType: 'video/mp4', metadata: null } }));

    expect(def.width).toBe(0);
    expect(def.height).toBe(0);
  });

  test('m3u8() accepts VideoDef — returns its URL directly', () => {
    const def = media.video.def(asset({ id: 'vid' }));

    expect(media.video.m3u8(def)).toBe(def.url);
  });

  test('m3u8() accepts MediaAsset — builds URL from asset id', () => {
    expect(media.video.m3u8(asset({ id: 'vid-2' }))).toBe(`${baseUrl}/v/vid-2/master.m3u8`);
  });
});

describe('MediaResolver.file', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths, filesPath: '/f/' });

  test('def() builds FileDef from original using filesPath', () => {
    const def = media.file.def(
      asset({ id: 'f1', original: { uid: 'f-uid', mimeType: 'application/pdf', metadata: null } }),
    );

    expect(def).toEqual({ id: 'f1', url: `${baseUrl}/f/f-uid.pdf` });
  });
});
