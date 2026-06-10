import type { ContelloClient } from '@contello/client';
import { defineMiddleware } from 'astro/middleware';
import type { Contello } from './contello';
import { wrap } from './diagnostics';

export type ContelloAssetsImagesOptions = {
  cacheControl?: string | undefined;
};

export type ContelloAssetsFilesOptions = {
  cacheControl?: string | undefined;
};

export type ContelloAssetsVideoOptions = Record<string, never>;

export type ContelloAssetsMiddlewareOptions = {
  images?: ContelloAssetsImagesOptions | undefined;
  files?: ContelloAssetsFilesOptions | undefined;
  video?: ContelloAssetsVideoOptions | undefined;
};

const DEFAULT_IMAGES_CACHE_CONTROL = 'public, max-age=31536000';

export function createBoundAssetsMiddleware(
  contello: Contello<any>,
  options: ContelloAssetsMiddlewareOptions | undefined,
) {
  const imagesPrefix = contello.media.imagesPath;
  const imagesCacheControl = options?.images?.cacheControl ?? DEFAULT_IMAGES_CACHE_CONTROL;
  const filesPrefix = contello.media.filesPath;
  const filesCacheControl = options?.files?.cacheControl;
  const videoPrefix = contello.media.videosPath;

  return defineMiddleware((ctx, next) => {
    const { pathname } = ctx.url;
    const isImage = pathname.startsWith(imagesPrefix);
    const isFile = !isImage && pathname.startsWith(filesPrefix);
    const isVideo = !isImage && !isFile && pathname.startsWith(videoPrefix);

    if (!isImage && !isFile && !isVideo) {
      return next();
    }

    if (!contello.isReady) {
      console.warn(`[@contello/astro] not initialized, passing through: ${pathname}`);

      return next();
    }

    if (isImage) {
      return handleFile(contello.client, next, pathname.slice(imagesPrefix.length), imagesCacheControl);
    }

    if (isFile) {
      return handleFile(contello.client, next, pathname.slice(filesPrefix.length), filesCacheControl);
    }

    return handleVideo(contello.client, next, pathname.slice(videoPrefix.length), ctx.request.signal);
  });
}

function handleFile(
  client: ContelloClient<any>,
  next: () => Response | Promise<Response>,
  rest: string,
  cacheControl: string | undefined,
) {
  const dot = rest.indexOf('.');
  const fileId = dot === -1 ? rest : rest.slice(0, dot);

  if (!fileId) {
    return next();
  }

  return wrap('assets:file', () => client.download(fileId)).then(
    (result) => {
      const headers = new Headers({ 'content-type': result.mimeType });

      if (cacheControl) {
        headers.set('cache-control', cacheControl);
      }

      if (result.size > 0) {
        headers.set('content-length', String(result.size));
      }

      return new Response(result.stream(), { headers });
    },
    () => new Response(null, { status: 404 }),
  );
}

function handleVideo(
  client: ContelloClient<any>,
  next: () => Response | Promise<Response>,
  path: string,
  signal: AbortSignal,
) {
  if (!path) {
    return next();
  }

  return wrap('assets:hls', () => client.proxyHls(path, signal)).then(
    (result) => new Response(result.stream(), { status: result.status, headers: result.headers }),
    () => new Response('Upstream is down', { status: 502, headers: { 'content-type': 'text/plain' } }),
  );
}
