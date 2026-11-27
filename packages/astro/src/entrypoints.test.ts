import { afterEach, describe, expect, test, vi } from 'vitest';

const instance = {
  createAssetsMiddleware: vi.fn(() => 'the assets middleware'),
  createRoutingMiddleware: vi.fn((_options: unknown) => 'the routing middleware'),
};

function serve(exclude: unknown): void {
  vi.doMock('virtual:@contello/astro/instance', () => ({ contello: instance }));
  vi.doMock('virtual:@contello/astro/config', () => ({ exclude }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('integration middleware entrypoints', () => {
  test('the assets entrypoint exports the assets middleware of the project instance', async () => {
    serve(null);

    const { onRequest } = await import('./assets-middleware-entrypoint');

    expect(onRequest).toBe('the assets middleware');
    expect(instance.createAssetsMiddleware).toHaveBeenCalledWith();
  });

  test('the routing entrypoint hands the configured exclude patterns to the routing middleware', async () => {
    const exclude = [{ prefix: '/api/' }, { pattern: /\.xml$/ }];

    serve(exclude);

    const { onRequest } = await import('./routing-middleware-entrypoint');

    expect(onRequest).toBe('the routing middleware');
    expect(instance.createRoutingMiddleware).toHaveBeenCalledWith({ exclude });
  });

  test('the routing entrypoint leaves the excludes to the middleware default when none are configured', async () => {
    serve(null);

    await import('./routing-middleware-entrypoint');

    expect(instance.createRoutingMiddleware).toHaveBeenCalledWith({ exclude: undefined });
  });
});
