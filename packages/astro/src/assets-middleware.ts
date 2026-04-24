import { defineMiddleware } from 'astro/middleware';
import type { Contello } from './contello';
import { wrap } from './diagnostics';

export type ContelloAssetsImagesOptions = {
  cacheControl?: string | undefined;
};

export type ContelloAssetsFilesOptions = {
  cacheControl?: string | undefined;
};

// eslint-disable-next-line
export type ContelloAssetsVideoOptions = {};

export type ContelloAssetsMiddlewareOptions = {
  images?: ContelloAssetsImagesOptions | undefined;
  files?: ContelloAssetsFilesOptions | undefined;
  video?: ContelloAssetsVideoOptions | undefined;
};

const DEFAULT_IMAGES_CACHE_CONTROL = 'public, max-age=31536000';

export function createAssetsMiddleware(
  instance: Contello<any, any>,
  options?: ContelloAssetsMiddlewareOptions | undefined,
) {
  const imagesPrefix = instance.media.imagesPath;
  const imagesCacheControl = options?.images?.cacheControl ?? DEFAULT_IMAGES_CACHE_CONTROL;
  const filesPrefix = instance.media.filesPath;
  const filesCacheControl = options?.files?.cacheControl;
  const videoPrefix = instance.media.videosPath;

  return defineMiddleware((ctx, next) => {
    const { pathname } = ctx.url;
    const isImage = pathname.startsWith(imagesPrefix);
    const isFile = !isImage && pathname.startsWith(filesPrefix);
    const isVideo = !isImage && !isFile && pathname.startsWith(videoPrefix);

    if (!isImage && !isFile && !isVideo) {
      return next();
    }

    if (!instance.isReady) {
      console.warn(`[@contello/astro] not initialized, passing through: ${pathname}`);

      return next();
    }

    if (isImage) {
      return handleFile(instance, next, pathname.slice(imagesPrefix.length), imagesCacheControl);
    }

    if (isFile) {
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
