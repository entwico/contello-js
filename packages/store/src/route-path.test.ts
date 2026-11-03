import { describe, expect, test } from 'vitest';

import { normalizeRoutePath } from './route-path';

describe('normalizeRoutePath', () => {
  test('every spelling of a path gives the stored form', () => {
    for (const spelling of ['/über-uns', '/u\u{0308}ber-uns', '/%C3%BCber-uns', '/%c3%bcber-uns', '/u%cc%88ber-uns']) {
      expect(normalizeRoutePath(spelling), spelling).toBe('/über-uns');
    }

    expect(normalizeRoutePath('/%41%28b%29%2Bc')).toBe('/A(b)+c');
  });

  test('the escapes a path cannot hold decoded stay encoded', () => {
    const cases: Record<string, string> = {
      '/a%2Fb': '/a%2Fb',
      '/a%2fb': '/a%2Fb',
      '/100%25': '/100%25',
      '/q%3Fx%23y': '/q%3Fx%23y',
      '/a%20b': '/a%20b',
      '/a%C2%A0b': '/a%C2%A0b',
      '/a%0Ab': '/a%0Ab',
      '/%C3%BC%2F%C3%A4': '/ü%2Fä',
      // a percent sign that starts no escape and a broken sequence are kept
      '/100%': '/100%',
      '/%zz': '/%zz',
      '/%C3%2F': '/%C3%2F',
      '/about': '/about',
      '/a+b': '/a+b',
    };

    for (const [input, expected] of Object.entries(cases)) {
      expect(normalizeRoutePath(input), input).toBe(expected);
    }
  });

  test('normalizing twice changes nothing', () => {
    for (const path of ['/', '/über-uns', '/a%2Fb', '/100%25', '/%2541', '/a%20b', '/100%', '/%zz', '/%C3%2F']) {
      const once = normalizeRoutePath(path);

      expect(normalizeRoutePath(once), path).toBe(once);
    }
  });
});
