import type { MediaResolver } from '@contello/media';
import { describe, expect, expectTypeOf, test } from 'vitest';

import { createStore } from './store';

// These tests exercise the generic narrowing and runtime behavior of store.media.
// They construct Store instances with various `media` option shapes and verify that
// the type of `store.media` narrows correctly, plus that accessing it without
// configuration throws at runtime. Store isn't initialized (no network) — we're
// only testing option plumbing + getter behavior.

const baseOptions = {
  url: 'ws://unused',
  project: 'test',
  token: 'test',
};

const fallbackImage = {
  id: 'fallback',
  variants: [{ type: 'image/jpeg', url: '/fb.jpg', width: 100, height: 100 }],
};

describe('store.media integration', () => {
  test('throws when media option was not provided', () => {
    const store = createStore(baseOptions);

    expect(() => store.media).toThrow(/media.*option/);
  });

  test('returns a MediaResolver when media option is provided', () => {
    const store = createStore({ ...baseOptions, media: { baseUrl: 'https://cdn.test' } });

    const media = store.media;

    expect(media.baseUrl).toBe('https://cdn.test');
  });

  test('MediaResolver narrows when fallback is configured', () => {
    const store = createStore({
      ...baseOptions,
      media: { baseUrl: 'https://cdn.test', fallback: fallbackImage },
    });

    // type: MediaResolver<true> — image.def(null) returns ImageDef, not ImageDef | undefined
    expectTypeOf(store.media).toEqualTypeOf<MediaResolver<true>>();

    const def = store.media.image.def(null);

    expect(def).toBe(fallbackImage);
  });

  test('store.media is typed as `never` when media option is absent (compile-time guard)', () => {
    const _store = createStore(baseOptions);

    // type-level check — don't evaluate the getter (which throws)
    type MediaType = typeof _store.media;
    expectTypeOf<MediaType>().toBeNever();
  });

  test('MediaResolver without fallback narrows to MediaResolver<false>', () => {
    const store = createStore({ ...baseOptions, media: { baseUrl: 'https://cdn.test' } });

    expectTypeOf(store.media).toEqualTypeOf<MediaResolver<false>>();
  });
});
