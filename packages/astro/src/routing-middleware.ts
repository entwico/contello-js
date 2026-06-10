import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/excludes';
import {
  type LazyRoutes,
  type MaybePromise,
  type Routes,
  type RoutesSync,
  type StoreRoute,
  type StoreRouteCustomHeader,
  maybeThen,
} from '@contello/store';
import type { APIContext, ValidRedirectStatus } from 'astro';
import { defineMiddleware } from 'astro/middleware';
import { type Contello, runRequest } from './contello';
import { wrap } from './diagnostics';

export type AnyRoutes = Routes | RoutesSync | LazyRoutes;

/**
 * Derives the path used to look up a Contello route from the request context.
 *
 * @default `(ctx) => ctx.url.pathname`
 *
 * ```ts
 * resolveRoutePath: (ctx) => `/${ctx.url.hostname}${ctx.url.pathname}`
 * ```
 */
export type RoutePathResolver = (ctx: APIContext) => string;

export type ContelloRoutingMiddlewareOptions = {
  /**
   * Routes instance backing the middleware.
   *
   * Defaults to a `LazyRoutes` instance managed by contello (fetched on demand, no init-time load).
   * For eager routing, create a `RoutesSync` via `contello.defineRoutesSync()`, add it to
   * `contello.init({ load: [routes] })`, and pass that same instance here.
   */
  routes?: AnyRoutes | undefined;
  exclude?: ExcludePattern[] | undefined;
  resolveRoutePath?: RoutePathResolver | undefined;
};

function customHeaders(headers: readonly StoreRouteCustomHeader[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const h of headers) {
    result[h.name] = h.value;
  }

  return result;
}

export function createBoundRoutingMiddleware(
  contello: Contello<any>,
  routes: AnyRoutes,
  exclude: ExcludePattern[] | undefined,
  resolveRoutePath: RoutePathResolver | undefined,
) {
  return defineMiddleware((ctx, next) => {
    if (shouldExclude(ctx, exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    if (!contello.isReady) {
      console.warn(`[@contello/astro] not initialized, passing through: ${ctx.url.pathname}`);

      return next();
    }

    const { url } = ctx;

    if (url.pathname.startsWith('/contello/entities/')) {
      return contello[runRequest]({ url, route: undefined, rewritten: false }, () => next());
    }

    const path = resolveRoutePath ? resolveRoutePath(ctx) : url.pathname;
    const lookup = routes.getByPath(path) as MaybePromise<StoreRoute | undefined>;

    return maybeThen(lookup, (route) => {
      if (!route) {
        return contello[runRequest]({ url, route: undefined, rewritten: false }, () => next());
      }

      switch (route.type) {
        case 'redirect': {
          return contello[runRequest]({ url, route, rewritten: false }, () =>
            wrap(
              'route:redirect',
              () =>
                new Response(null, {
                  status: route.status as ValidRedirectStatus,
                  headers: {
                    Location: route.location,
                    ...customHeaders(route.customHeaders),
                  },
                }),
            ),
          );
        }

        case 'text': {
          return contello[runRequest]({ url, route, rewritten: false }, () =>
            wrap(
              'route:text',
              () =>
                new Response(route.content, {
                  status: 200,
                  headers: {
                    'Content-Type': route.mimeType,
                    ...customHeaders(route.customHeaders),
                  },
                }),
            ),
          );
        }

        case 'asset': {
          return contello[runRequest]({ url, route, rewritten: false }, () =>
            wrap('route:asset', async () => {
              const result = await contello.client.download(route.fileId);
              const headers = new Headers({ 'content-type': result.mimeType });

              if (result.size > 0) {
                headers.set('content-length', String(result.size));
              }

              for (const { name, value } of route.customHeaders) {
                headers.set(name, value);
              }

              return new Response(result.stream(), { headers });
            }),
          );
        }

        case 'entity': {
          return contello[runRequest]({ url, route, rewritten: true }, () =>
            wrap(`route:entity:${route.model}`, async () => {
              const response = await next(`/contello/entities/${route.model}/${route.entityId}${url.search}`);

              for (const { name, value } of route.customHeaders) {
                response.headers.set(name, value);
              }

              return response;
            }),
          );
        }
      }
    });
  });
}
