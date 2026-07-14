import { describe, expect, expectTypeOf, test } from 'vitest';

import { type MediaResolverOptions, createMediaResolver } from './resolver';
import type { DeepReadonly, ImageDef, ImageMetadata, ImageSource, MediaAsset, VideoSource } from './types';

const baseUrl = 'https://cdn.example.com';

const testPaths = { imagesPath: '/i/', videosPath: '/v/' } satisfies Partial<MediaResolverOptions>;

function asset(partial: Partial<MediaAsset> & Pick<MediaAsset, 'id'>): MediaAsset {
  return {
    original: { uid: 'orig-uid', mimeType: 'image/jpeg', metadata: { width: 4000, height: 3000 } },
    optimized: [],
    ...partial,
  };
}

// bundled-image (astro `ImageMetadata`) fixtures — these map 1:1 to variants
const multiFormat: ImageMetadata[] = [
  { src: '/a-400', format: 'avif', width: 400, height: 300 },
  { src: '/a-800', format: 'avif', width: 800, height: 600 },
  { src: '/w-400', format: 'webp', width: 400, height: 300 },
  { src: '/w-800', format: 'webp', width: 800, height: 600 },
  { src: '/j-400', format: 'jpeg', width: 400, height: 300 },
  { src: '/j-800', format: 'jpeg', width: 800, height: 600 },
];

const webpJpeg: ImageMetadata[] = [
  { src: '/w-400', format: 'webp', width: 400, height: 300 },
  { src: '/w-800', format: 'webp', width: 800, height: 600 },
  { src: '/w-1200', format: 'webp', width: 1200, height: 900 },
  { src: '/j-400', format: 'jpeg', width: 400, height: 300 },
  { src: '/j-800', format: 'jpeg', width: 800, height: 600 },
  { src: '/j-1200', format: 'jpeg', width: 1200, height: 900 },
];

const fallbackMeta: ImageMetadata = { src: '/fallback.jpg', format: 'jpeg', width: 100, height: 100 };

// URL construction is verified through the resolved outputs — the only surfaces consumers see.
describe('MediaResolver URL construction', () => {
  const oneOptimized = (uid: string, mime: string) =>
    asset({ id: 'a', optimized: [{ uid, mimeType: mime, metadata: { width: 100, height: 100 } }] });

  test.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/svg+xml', 'svg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/avif', 'avif'],
  ])('appends .%s extension for %s variants', (mime, ext) => {
    const media = createMediaResolver({ baseUrl, ...testPaths });

    expect(media.image.url(oneOptimized('abc', mime), 'web')).toBe(`${baseUrl}/i/abc.${ext}`);
  });

  test('file.source omits extension for unknown mime types', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, filesPath: '/f/' });
    const file = media.file.source(
      asset({ id: 'f', original: { uid: 'abc', mimeType: 'application/x-weird', metadata: null } }),
    );

    expect(file.url).toBe(`${baseUrl}/f/abc`);
  });

  test('strips trailing slash from baseUrl', () => {
    const m = createMediaResolver({ baseUrl: `${baseUrl}/`, ...testPaths });

    expect(m.image.url(oneOptimized('x', 'image/jpeg'), 'web')).toBe(`${baseUrl}/i/x.jpg`);
  });

  test('honors custom imagesPath (for proxied setups)', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '/_contello/i/' });

    expect(m.image.url(oneOptimized('abc', 'image/jpeg'), 'web')).toBe('/_contello/i/abc.jpg');
  });

  test('honors custom videosPath via video.m3u8', () => {
    const m = createMediaResolver({ baseUrl: '', videosPath: '/_contello/v/' });

    expect(
      m.video.m3u8({ id: 'vid', original: { uid: 'v', mimeType: 'video/mp4', metadata: null }, optimized: [] }),
    ).toBe('/_contello/v/vid/master.m3u8');
  });

  test('normalizes imagesPath to ensure leading + trailing slash', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '_contello/i' });

    expect(m.image.url(oneOptimized('x', 'image/jpeg'), 'web')).toBe('/_contello/i/x.jpg');
  });

  test('filesPath is separate from imagesPath', () => {
    const m = createMediaResolver({ baseUrl: '', imagesPath: '/i/', filesPath: '/f/' });
    const file = m.file.source(
      asset({ id: 'f', original: { uid: 'file-uid', mimeType: 'application/pdf', metadata: null } }),
    );

    expect(m.image.url(oneOptimized('img', 'image/webp'), 'web')).toBe('/i/img.webp');
    expect(file.url).toBe('/f/file-uid.pdf');
  });
});

describe('MediaResolver image variant building (via image.source)', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('builds avif <source> from a MediaAsset with optimized variants', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        optimized: [
          { uid: 'a1', mimeType: 'image/avif', metadata: { width: 800, height: 600 } },
          { uid: 'a2', mimeType: 'image/avif', metadata: { width: 1600, height: 1200 } },
        ],
      }),
    );

    expect(data.id).toBe('a');
    expect(data.sources![0]!.srcset).toBe(`${baseUrl}/i/a1.avif 800w, ${baseUrl}/i/a2.avif 1600w`);
  });

  test('includes the preview as an additional variant (largest jpeg → <img> fallback)', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        preview: { uid: 'p', mimeType: 'image/jpeg', metadata: { width: 1000, height: 750 } },
        optimized: [{ uid: 'a1', mimeType: 'image/avif', metadata: { width: 800, height: 600 } }],
      }),
    );

    // avif goes to the <source>; the jpeg preview is the bare <img> fallback
    expect(data.sources![0]!.type).toBe('image/avif');
    expect(data.image!.url).toBe(`${baseUrl}/i/p.jpg`);
  });

  test('SVG original bypasses optimized variants and uses the original directly', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        original: { uid: 'svg', mimeType: 'image/svg+xml', metadata: { width: 200, height: 200 } },
        optimized: [{ uid: 'a1', mimeType: 'image/avif', metadata: { width: 800, height: 600 } }],
      }),
    );

    expect(data.image!.url).toBe(`${baseUrl}/i/svg.svg`);
    expect(data.sources).toBeUndefined();
  });
});

describe('MediaResolver.image.url', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('picks highest-priority format; smallest-width wins within tier', () => {
    expect(media.image.url(webpJpeg, 'web')).toBe('/w-400');
  });

  test('respects minWidth: smallest variant that meets threshold', () => {
    expect(media.image.url(webpJpeg, 'web', { minWidth: 600 })).toBe('/w-800');
  });

  test('respects maxWidth: smallest within bounds', () => {
    expect(media.image.url(webpJpeg, 'web', { maxWidth: 800 })).toBe('/w-400');
  });

  test('og targets the largest jpeg within 600-1200 (closest to ~1200)', () => {
    expect(media.image.url(webpJpeg, 'og')).toBe('/j-1200');
  });

  test('jsonld targets the largest jpeg at or above 1000 (no upper cap)', () => {
    expect(media.image.url(webpJpeg, 'jsonld')).toBe('/j-1200');
  });

  test('jsonld degrades to the largest jpeg below 1000 when none meet the floor', () => {
    const smallJpeg: ImageMetadata[] = [
      { src: '/j-400', format: 'jpeg', width: 400, height: 300 },
      { src: '/j-800', format: 'jpeg', width: 800, height: 600 },
    ];

    expect(media.image.url(smallJpeg, 'jsonld')).toBe('/j-800');
  });

  test('email preset prefers jpeg over webp', () => {
    expect(media.image.url(webpJpeg, 'email')).toBe('/j-400');
  });

  test('falls back to largest variant below minWidth when none meet threshold', () => {
    expect(media.image.url(webpJpeg, 'web', { minWidth: 2000 })).toBe('/w-1200');
  });

  test('honors format priority within the below-minWidth fallback', () => {
    const def: ImageMetadata[] = [
      { src: '/w-1200', format: 'webp', width: 1200, height: 900 },
      { src: '/j-1800', format: 'jpeg', width: 1800, height: 1350 },
    ];

    expect(media.image.url(def, 'web', { minWidth: 2000 })).toBe('/w-1200');
  });

  test('falls back to smallest variant above maxWidth when none fit', () => {
    expect(media.image.url(webpJpeg, 'web', { maxWidth: 100 })).toBe('/w-400');
  });

  test('returns empty string for null source with no fallback', () => {
    expect(media.image.url(null, 'web')).toBe('');
  });

  test('per-call fallback applies when source is null', () => {
    expect(media.image.url(null, 'web', { fallback: fallbackMeta })).toBe('/fallback.jpg');
  });

  test('accepts a single ImageMetadata', () => {
    expect(media.image.url({ src: '/single.webp', format: 'webp', width: 800, height: 600 }, 'web')).toBe('/single.webp');
  });
});

describe('MediaResolver.image.source', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('emits a single <source> for the best available format (avif wins over webp)', () => {
    const data = media.image.source(multiFormat);

    expect(data.sources!.map((s) => s.type)).toEqual(['image/avif']);
  });

  test('cascades to webp when no avif variants exist', () => {
    const data = media.image.source(webpJpeg);

    expect(data.sources!.map((s) => s.type)).toEqual(['image/webp']);
  });

  test('cascades to the <img> jpeg srcset when neither avif nor webp variants exist', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        optimized: [
          { uid: 'j4', mimeType: 'image/jpeg', metadata: { width: 400, height: 300 } },
          { uid: 'j7', mimeType: 'image/jpeg', metadata: { width: 700, height: 525 } },
        ],
      }),
    );

    expect(data.sources).toBeUndefined();
    expect(data.image!.srcset).toBe(`${baseUrl}/i/j4.jpg 400w, ${baseUrl}/i/j7.jpg 700w`);
  });

  test('each <source> srcset lists widths of that format ascending', () => {
    const data = media.image.source(multiFormat);

    expect(data.sources![0]!.srcset).toBe('/a-400 400w, /a-800 800w');
  });

  test('<img> fallback is a single capped src with no srcset when <source>s exist', () => {
    const data = media.image.source(multiFormat);

    expect(data.image!.url).toBe('/j-800'); // largest jpeg within the 1200 cap
    expect(data.image!.srcset).toBeUndefined();
  });

  test('caps the bare <img> src at 1200 but keeps the full srcset when the <img> is the only candidate', () => {
    const def: ImageMetadata[] = [
      { src: '/j-600', format: 'jpeg', width: 600, height: 450 },
      { src: '/j-1000', format: 'jpeg', width: 1000, height: 750 },
      { src: '/j-2000', format: 'jpeg', width: 2000, height: 1500 },
    ];
    const data = media.image.source(def);

    expect(data.sources).toBeUndefined();
    expect(data.image!.url).toBe('/j-1000'); // largest jpeg <= 1200, not the 2000
    expect(data.image!.srcset).toBe('/j-600 600w, /j-1000 1000w, /j-2000 2000w');
  });

  test('collapses duplicate width descriptors in a <source> srcset, keeping the first', () => {
    const def: ImageMetadata[] = [
      { src: '/a-1920', format: 'avif', width: 1920, height: 1080 },
      { src: '/a-2560-ladder', format: 'avif', width: 2560, height: 1440 },
      { src: '/a-2560-original', format: 'avif', width: 2560, height: 1440 },
    ];
    const data = media.image.source(def);

    expect(data.sources![0]!.srcset).toBe('/a-1920 1920w, /a-2560-ladder 2560w');
  });

  test('omits srcset on image when there is only a single main-format variant', () => {
    const data = media.image.source({ src: '/only', format: 'jpeg', width: 400, height: 300 });

    expect(data.image!.srcset).toBeUndefined();
    expect(data.image!.url).toBe('/only');
  });

  test('returns empty object for null source with no fallback', () => {
    expect(media.image.source(null)).toEqual({});
  });

  test('excludes asset variants without positive dimensions from <source> and <img>', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        optimized: [
          { uid: 'a0', mimeType: 'image/avif', metadata: { width: 0, height: 0 } },
          { uid: 'a1', mimeType: 'image/avif', metadata: { width: 800, height: 600 } },
          { uid: 'j0', mimeType: 'image/jpeg', metadata: { width: 500, height: 0 } },
          { uid: 'j1', mimeType: 'image/jpeg', metadata: { width: 700, height: 525 } },
        ],
      }),
    );

    expect(data.sources![0]!.srcset).toBe(`${baseUrl}/i/a1.avif 800w`);
    expect(data.image!.url).toBe(`${baseUrl}/i/j1.jpg`);
    expect(data.image!.width).toBe(800);
  });

  test('excludes zero-dimension variants from the <img> srcset when it is the only candidate', () => {
    const data = media.image.source(
      asset({
        id: 'a',
        optimized: [
          { uid: 'j0', mimeType: 'image/jpeg', metadata: { width: 0, height: 0 } },
          { uid: 'j4', mimeType: 'image/jpeg', metadata: { width: 400, height: 300 } },
          { uid: 'j7', mimeType: 'image/jpeg', metadata: { width: 700, height: 525 } },
        ],
      }),
    );

    expect(data.sources).toBeUndefined();
    expect(data.image!.srcset).toBe(`${baseUrl}/i/j4.jpg 400w, ${baseUrl}/i/j7.jpg 700w`);
  });

  test('custom formats override default', () => {
    const data = media.image.source(multiFormat, { formats: ['image/webp'] });

    expect(data.sources!.map((s) => s.type)).toEqual(['image/webp']);
  });

  test('skips formats with no matching variants', () => {
    const data = media.image.source(multiFormat, { formats: ['image/avif', 'image/heic'] });

    expect(data.sources!.map((s) => s.type)).toEqual(['image/avif']);
  });
});

describe('MediaResolver fallback handling', () => {
  test('no fallback flag on a real image', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackMeta });
    const data = media.image.source(multiFormat);

    expect(data.fallback).toBeUndefined();
  });

  test('configured fallback substitutes for a missing source and sets fallback: true', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackMeta });
    const data = media.image.source(null);

    expect(data.fallback).toBe(true);
    expect(data.id).toBe('fallback'); // default id for a bundled fallback
    expect(data.image!.url).toBe('/fallback.jpg');
  });

  test('an asset whose variants all lack dimensions counts as empty (fallback applies)', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackMeta });
    const data = media.image.source(
      asset({ id: 'a', optimized: [{ uid: 'x', mimeType: 'image/jpeg', metadata: { width: 0, height: 0 } }] }),
    );

    expect(data.fallback).toBe(true);
    expect(data.id).toBe('fallback');
  });

  test('configured fallback substitutes for an empty source too', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackMeta });
    const data = media.image.source([]);

    expect(data.fallback).toBe(true);
  });

  test('named fallback keeps its id (to tell multiple fallbacks apart)', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: { id: 'brand', image: fallbackMeta } });
    const data = media.image.source(null);

    expect(data.fallback).toBe(true);
    expect(data.id).toBe('brand');
  });

  test('a MediaAsset fallback keeps the asset id', () => {
    const fallbackAsset = asset({
      id: 'asset-fb',
      optimized: [{ uid: 'fb', mimeType: 'image/avif', metadata: { width: 800, height: 600 } }],
    });
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackAsset });
    const data = media.image.source(null);

    expect(data.fallback).toBe(true);
    expect(data.id).toBe('asset-fb');
  });

  test('per-call fallback wins for a missing source', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths });
    const data = media.image.source(null, { fallback: fallbackMeta });

    expect(data.fallback).toBe(true);
    expect(data.image!.url).toBe('/fallback.jpg');
  });

  test('no fallback configured → empty object for a missing source', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths });

    expect(media.image.source(null)).toEqual({});
  });

  test('a fallback that resolves to no image counts as no fallback', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: [] });

    expect(media.image.source(null)).toEqual({});
  });

  test('fallback from multiple bundled variants', () => {
    const media = createMediaResolver({
      baseUrl,
      ...testPaths,
      fallback: {
        id: 'fallback',
        image: [
          { src: '/fb.avif', format: 'avif', width: 800, height: 600 },
          { src: '/fb.jpg', format: 'jpeg', width: 800, height: 600 },
        ],
      },
    });
    const data = media.image.source(null);

    expect(data.sources!.map((s) => s.type)).toEqual(['image/avif']);
    expect(data.image!.url).toBe('/fb.jpg');
  });

  test('config.fallback type narrows to a defined value when a fallback is configured', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths, fallback: fallbackMeta });

    expectTypeOf(media.config.fallback).toEqualTypeOf<ImageDef>();
  });

  test('config.fallback type is optional when no fallback is configured', () => {
    const media = createMediaResolver({ baseUrl, ...testPaths });

    expectTypeOf(media.config.fallback).toEqualTypeOf<ImageDef | undefined>();
  });
});

describe('MediaResolver.video', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths });

  test('source() builds VideoSource with m3u8 URL + dimensions', () => {
    const source = media.video.source(
      asset({ id: 'vid', original: { uid: 'v', mimeType: 'video/mp4', metadata: { width: 1920, height: 1080 } } }),
    );

    expect(source).toEqual({
      id: 'vid',
      url: `${baseUrl}/v/vid/master.m3u8`,
      width: 1920,
      height: 1080,
    });
  });

  test('source() defaults dimensions to 0 when metadata is missing', () => {
    const source = media.video.source(asset({ id: 'vid', original: { uid: 'v', mimeType: 'video/mp4', metadata: null } }));

    expect(source.width).toBe(0);
    expect(source.height).toBe(0);
  });

  test('m3u8() accepts a VideoSource — returns its URL directly', () => {
    const source = media.video.source(asset({ id: 'vid' }));

    expect(media.video.m3u8(source)).toBe(source.url);
  });

  test('m3u8() accepts a MediaAsset — builds URL from asset id', () => {
    expect(media.video.m3u8(asset({ id: 'vid-2' }))).toBe(`${baseUrl}/v/vid-2/master.m3u8`);
  });
});

describe('MediaResolver.file', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths, filesPath: '/f/' });

  test('source() builds FileSource with url + mimeType from the original', () => {
    const file = media.file.source(
      asset({ id: 'f1', original: { uid: 'f-uid', mimeType: 'application/pdf', metadata: null } }),
    );

    expect(file).toEqual({ id: 'f1', url: `${baseUrl}/f/f-uid.pdf`, mimeType: 'application/pdf' });
  });
});

describe('MediaResolver deeply-readonly inputs', () => {
  const media = createMediaResolver({ baseUrl, ...testPaths, filesPath: '/f/' });

  const roAsset: DeepReadonly<MediaAsset> = asset({
    id: 'ro',
    optimized: [{ uid: 'o', mimeType: 'image/avif', metadata: { width: 800, height: 600 } }],
  });
  const roMetadata: DeepReadonly<ImageMetadata> = { src: '/ro.webp', format: 'webp', width: 100, height: 100 };

  test('image.source / image.url accept readonly asset and metadata sources', () => {
    expect(media.image.source(roAsset).id).toBe('ro');
    expect(media.image.url(roAsset, 'web')).toContain('/i/');
    expect(media.image.url(roMetadata, 'web')).toBe('/ro.webp');
  });

  test('video / file accept readonly sources', () => {
    const roVideoSource: DeepReadonly<VideoSource> = media.video.source(roAsset);

    expect(media.video.m3u8(roVideoSource)).toBe(roVideoSource.url);
    expect(media.video.m3u8(roAsset)).toContain('/master.m3u8');
    expect(media.file.source(roAsset).id).toBe('ro');
  });

  test('outputs stay mutable so they re-feed the resolver', () => {
    expectTypeOf(media.image.source(roAsset)).toEqualTypeOf<ImageSource>();
  });
});
