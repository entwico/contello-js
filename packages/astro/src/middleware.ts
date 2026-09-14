import type { MiddlewareHandler } from 'astro';

// a local identity instead of `astro/middleware`: a runtime import of astro's middleware entry pulls every module that
// imports this package into astro's runtime module graph — in dev, astro invalidates that graph on any file change,
// which re-evaluates boot-loaded singletons and makes @astroscope/node restart the server on every component edit
export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
  return handler;
}
