import { describe, expect, test } from 'bun:test';
import { parseUrl } from './url-parser';

// mock location.href for parseUrl
const originalLocation = globalThis.location;

function withLocation(href: string, fn: () => void) {
  Object.defineProperty(globalThis, 'location', { value: { href }, writable: true });

  try {
    fn();
  } finally {
    Object.defineProperty(globalThis, 'location', { value: originalLocation, writable: true });
  }
}

describe('parseUrl', () => {
  test('parses valid URL parameters', () => {
    withLocation(
      'https://ext.example.com?channelId=ch-1&origin=https://contello.example.com&applicationId=app-1&debug=false',
      () => {
        const result = parseUrl(['https://contello.example.com']);

        expect(result.channelId).toBe('ch-1');
        expect(result.targetOrigin).toBe('https://contello.example.com');
        expect(result.applicationId).toBe('app-1');
        expect(result.debug).toBe(false);
      },
    );
  });

  test('parses debug=true', () => {
    withLocation(
      'https://ext.example.com?channelId=ch-1&origin=https://contello.example.com&applicationId=app-1&debug=true',
      () => {
        const result = parseUrl(['https://contello.example.com']);

        expect(result.debug).toBe(true);
      },
    );
  });

  test('throws on missing channelId', () => {
    withLocation('https://ext.example.com?origin=https://contello.example.com&applicationId=app-1', () => {
      expect(() => parseUrl(['https://contello.example.com'])).toThrow('Missing required URL parameters');
    });
  });

  test('throws on untrusted origin', () => {
    withLocation('https://ext.example.com?channelId=ch-1&origin=https://evil.example.com&applicationId=app-1', () => {
      expect(() => parseUrl(['https://contello.example.com'])).toThrow('not trusted');
    });
  });

  test('throws on empty trustedOrigins', () => {
    withLocation(
      'https://ext.example.com?channelId=ch-1&origin=https://contello.example.com&applicationId=app-1',
      () => {
        expect(() => parseUrl([])).toThrow('No trusted origins provided');
      },
    );
  });
});
