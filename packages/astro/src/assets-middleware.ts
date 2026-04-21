import { defineMiddleware } from 'astro/middleware';
import type { Contello } from './contello';
import { wrap } from './diagnostics';

export type ContelloAssetsImagesOptions = {
  prefix?: string | undefined;
  cacheControl?: string | undefined;
};

export type ContelloAssetsFilesOptions = {
  prefix?: string | undefined;
  cacheControl?: string | undefined;
};

export type ContelloAssetsVideoOptions = {
  prefix?: string | undefined;
};

export type ContelloAssetsMiddlewareOptions = {
  images?: ContelloAssetsImagesOptions | undefined;
  files?: ContelloAssetsFilesOptions | undefined;
  video?: ContelloAssetsVideoOptions | undefined;
};

const DEFAULT_IMAGES_PREFIX = '/_contello/i/';
const DEFAULT_FILES_PREFIX = '/_contello/f/';
const DEFAULT_VIDEO_PREFIX = '/_contello/v/';
const DEFAULT_IMAGES_CACHE_CONTROL = 'public, max-age=31536000';

export function createAssetsMiddleware(
  instance: Contello<any, any>,
  options?: ContelloAssetsMiddlewareOptions | undefined,
) {
  const imagesPrefix = options?.images?.prefix ?? DEFAULT_IMAGES_PREFIX;
  const imagesCacheControl = options?.images?.cacheControl ?? DEFAULT_IMAGES_CACHE_CONTROL;
  const filesPrefix = options?.files?.prefix ?? DEFAULT_FILES_PREFIX;
  const filesCacheControl = options?.files?.cacheControl;
  const videoPrefix = options?.video?.prefix ?? DEFAULT_VIDEO_PREFIX;

  return defineMiddleware((ctx, next) => {
    const { pathname } = ctx.url;
    const matches =
      pathname.startsWith(imagesPrefix) || pathname.startsWith(filesPrefix) || pathname.startsWith(videoPrefix);

    if (!matches) {
      return next();
    }

    if (!instance.isReady) {
      console.warn(`[@contello/astro] not initialized, passing through: ${pathname}`);

      return next();
    }

    if (pathname.startsWith(imagesPrefix)) {
      return handleFile(instance, next, pathname.slice(imagesPrefix.length), imagesCacheControl);
    }

    if (pathname.startsWith(filesPrefix)) {
      return handleFile(instance, next, pathname.slice(filesPrefix.length), filesCacheControl);
    }

    return handleVideo(instance, next, pathname.slice(videoPrefix.length), ctx.request.signal);
  });
}

function handleFile(
  instance: Contello<any, any>,
  next: () => Response | Promise<Response>,
  rest: string,
  cacheControl: string | undefined,
) {
  const dot = rest.indexOf('.');
  const fileId = dot === -1 ? rest : rest.slice(0, dot);

  if (!fileId) {
    return next();
  }

  return wrap('assets:file', () => instance.assets.download(fileId)).then(
    (result) => {
      const headers = new Headers({ 'content-type': result.mimeType });

      if (cacheControl) {
        headers.set('cache-control', cacheControl);
      }

      if (result.size) {
        headers.set('content-length', String(result.size));
      }

      return new Response(result.stream(), { headers });
    },
    () => new Response(null, { status: 404 }),
  );
}

function handleVideo(
  instance: Contello<any, any>,
  next: () => Response | Promise<Response>,
  path: string,
  signal: AbortSignal,
) {
  if (!path) {
    return next();
  }

  return wrap('assets:hls', () => instance.assets.proxyHls(path, signal)).then(
    (result) => new Response(result.stream(), { status: result.status, headers: result.headers }),
    () => new Response('Upstream is down', { status: 502, headers: { 'content-type': 'text/plain' } }),
  );
}
