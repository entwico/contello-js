import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/excludes';
import type { StoreRouteCustomHeader } from '@contello/store';
import type { ValidRedirectStatus } from 'astro';
import { defineMiddleware } from 'astro/middleware';
import { type Contello, runRequest } from './contello';
import { wrap } from './diagnostics';

export type ContelloMiddlewareOptions = {
  exclude?: ExcludePattern[] | undefined;
};

function customHeaders(headers: StoreRouteCustomHeader[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const h of headers) {
    result[h.name] = h.value;
  }

  return result;
}

export function createRoutingMiddleware(instance: Contello<any, any>, options?: ContelloMiddlewareOptions | undefined) {
  const { exclude } = options ?? {};

  return defineMiddleware(async (ctx, next) => {
    if (shouldExclude(ctx, exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    const { url } = ctx;

    if (url.pathname.startsWith('/contello/entities/')) {
      return instance[runRequest]({ url, route: undefined, rewritten: false }, () => next());
    }

    const route = await instance.routes.getByPath(url.pathname);

    if (!route) {
      return instance[runRequest]({ url, route: undefined, rewritten: false }, () => next());
    }

    switch (route.type) {
      case 'redirect':
        return instance[runRequest]({ url, route, rewritten: false }, () =>
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

      case 'text':
        return instance[runRequest]({ url, route, rewritten: false }, () =>
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

      case 'asset':
        return instance[runRequest]({ url, route, rewritten: false }, () =>
          wrap('route:asset', async () => {
            const result = await instance.assets.download(route.fileId);
            const headers = new Headers({ 'content-type': result.mimeType });

            if (result.size) {
              headers.set('content-length', String(result.size));
            }

            for (const { name, value } of route.customHeaders) {
              headers.set(name, value);
            }

            return new Response(result.stream(), { headers });
          }),
        );

      case 'entity':
        return instance[runRequest]({ url, route, rewritten: true }, () =>
          wrap(`route:entity:${route.model}`, async () => {
            const response = await next(`/contello/entities/${route.model}/${route.entityId}${url.search}`);

            for (const { name, value } of route.customHeaders) {
              response.headers.set(name, value);
            }

            return response;
          }),
        );
    }
  });
}
