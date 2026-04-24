import type { MediaResolver } from '@contello/media';
import { describe, expect, expectTypeOf, test } from 'vitest';

import { createStore } from './store';

// verify that store.media is always available (MediaResolver has sensible defaults for
// baseUrl and paths, so it can always be constructed). store isn't initialized — we're
// only testing option plumbing + property availability.

const baseOptions = {
  url: 'ws://unused',
  project: 'test',
  token: 'test',
};

const fallbackImage = {
  id: 'fallback',
  variants: [{ type: 'image/jpeg', url: '/fb.jpg', width: 100, height: 100 }],
};

describe('store.media', () => {
  test('is always available, defaulting to empty baseUrl when media option is absent', () => {
    const store = createStore(baseOptions);

    expect(store.media).toBeDefined();
    expect(store.media.baseUrl).toBe('');
  });

  test('honors explicit media options', () => {
    const store = createStore({ ...baseOptions, media: { baseUrl: 'https://cdn.test' } });

    expect(store.media.baseUrl).toBe('https://cdn.test');
  });

  test('per-call fallback narrows image.def to ImageDef', () => {
    const store = createStore({ ...baseOptions, media: { fallback: fallbackImage } });

    // runtime: project-level fallback applies when source is null
    const def = store.media.image.def(null, fallbackImage);

    expect(def).toBe(fallbackImage);
    expectTypeOf(def).toEqualTypeOf<typeof fallbackImage>();
  });

  test('store.media type is always MediaResolver (no narrowing)', () => {
    const store = createStore(baseOptions);

    expectTypeOf(store.media).toEqualTypeOf<MediaResolver>();
  });
});
