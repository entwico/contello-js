import { describe, expect, test } from 'vitest';

import { resolveSizes } from './sizes';

describe('resolveSizes', () => {
  test('returns undefined when no sizes are given', () => {
    expect(resolveSizes(undefined)).toBeUndefined();
  });

  describe('raw string input', () => {
    test('passes a sizes string through verbatim', () => {
      expect(resolveSizes('(min-width: 900px) 50vw, 100vw')).toBe('(min-width: 900px) 50vw, 100vw');
    });

    test('passes an empty string through verbatim', () => {
      expect(resolveSizes('')).toBe('');
    });
  });

  describe('SizesMap input', () => {
    test('with only base emits just the default clause (no media query)', () => {
      expect(resolveSizes({ base: '50vw' })).toBe('50vw');
    });

    test('base + one breakpoint emits the breakpoint clause then the default', () => {
      expect(resolveSizes({ base: '100vw', md: 400 })).toBe('(min-width: 768px) 400px, 100vw');
    });

    test('orders breakpoint clauses largest min-width first, base trailing', () => {
      expect(resolveSizes({ base: '100vw', md: 400, lg: 800 })).toBe(
        '(min-width: 1024px) 800px, (min-width: 768px) 400px, 100vw',
      );
    });

    test('orders all breakpoints largest-first regardless of key order', () => {
      expect(resolveSizes({ sm: 200, base: '100vw', xl: 1000, md: 400 })).toBe(
        '(min-width: 1280px) 1000px, (min-width: 768px) 400px, (min-width: 640px) 200px, 100vw',
      );
    });

    test('serializes every tailwind breakpoint, including 2xl', () => {
      expect(resolveSizes({ base: '100vw', sm: 100, md: 200, lg: 300, xl: 400, '2xl': 500 })).toBe(
        '(min-width: 1536px) 500px, (min-width: 1280px) 400px, (min-width: 1024px) 300px, ' +
        '(min-width: 768px) 200px, (min-width: 640px) 100px, 100vw',
      );
    });

    test('number values become px, string values pass through verbatim', () => {
      expect(resolveSizes({ base: '100vw', lg: 800 })).toBe('(min-width: 1024px) 800px, 100vw');
    });

    test('accepts a raw CSS string as a breakpoint value', () => {
      expect(resolveSizes({ base: '100vw', md: '50vw' })).toBe('(min-width: 768px) 50vw, 100vw');
    });

    test('a number base becomes px', () => {
      expect(resolveSizes({ base: 320 })).toBe('320px');
    });

    test('a zero value is kept (emitted as 0px), not dropped', () => {
      expect(resolveSizes({ base: '100vw', md: 0 })).toBe('(min-width: 768px) 0px, 100vw');
    });
  });
});
