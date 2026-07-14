import { afterEach, describe, expect, test, vi } from 'vitest';

const FLAGS = ['OTEL_CONTELLO_ENABLED', 'OTEL_CONTELLO_CAPTURE_QUERY', 'OTEL_CONTELLO_CAPTURE_VARIABLES'];

async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();

  for (const flag of FLAGS) {
    vi.stubEnv(flag, undefined);
  }

  for (const [key, value] of Object.entries(vars)) {
    vi.stubEnv(key, value);
  }

  const mod = await import('./env');

  return mod.otelEnv;
}

describe('otelEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('defaults: enabled on, captures off', async () => {
    const env = await loadEnv({});

    expect(env.enabled).toBe(true);
    expect(env.captureQuery).toBe(false);
    expect(env.captureVariables).toBe(false);
  });

  test('explicit truthy values enable capture flags', async () => {
    const env = await loadEnv({
      OTEL_CONTELLO_CAPTURE_QUERY: 'true',
      OTEL_CONTELLO_CAPTURE_VARIABLES: '1',
    });

    expect(env.captureQuery).toBe(true);
    expect(env.captureVariables).toBe(true);
  });

  test('falsy string values disable a flag', async () => {
    for (const raw of ['false', '0', 'no', 'off', 'FALSE', 'Off']) {
      const env = await loadEnv({ OTEL_CONTELLO_ENABLED: raw });

      expect(env.enabled).toBe(false);
    }
  });

  test('empty / whitespace value falls back to the default', async () => {
    const env = await loadEnv({ OTEL_CONTELLO_ENABLED: ' '.repeat(3) });

    expect(env.enabled).toBe(true);
  });

  test('unrecognized value is treated as enabled', async () => {
    const env = await loadEnv({ OTEL_CONTELLO_CAPTURE_QUERY: 'yes-please' });

    expect(env.captureQuery).toBe(true);
  });
});
