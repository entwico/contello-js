import { Agent, type Dispatcher, request as undiciRequest } from 'undici';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

const FORWARDED_PROXY_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-range',
  'content-encoding',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'age',
  'vary',
]);

function assertSafeSegment(segment: string, kind: string): void {
  if (segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment)) {
    throw new Error(`invalid ${kind}`);
  }
}

function assertSafeAssetPath(path: string, kind: string): void {
  if (path === '') {
    throw new Error(`invalid ${kind}`);
  }

  for (const segment of path.split('/')) {
    assertSafeSegment(segment, kind);
  }
}

export type HttpAgentOptions = {
  pipelining?: number | undefined;
  allowH2?: boolean | undefined;
  maxConcurrentStreams?: number | undefined;
  keepAliveTimeout?: number | undefined;
};

export function createHttpAgent(options?: HttpAgentOptions | undefined): Agent {
  return new Agent({
    pipelining: options?.pipelining ?? 10,
    allowH2: options?.allowH2 ?? true,
    maxConcurrentStreams: options?.maxConcurrentStreams ?? 128,
    keepAliveTimeout: options?.keepAliveTimeout ?? 60_000,
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 25,
  });
}

export type DownloadResult = {
  mimeType: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  stream(): ReadableStream<Uint8Array>;
};

export async function downloadFile(
  agent: Dispatcher,
  url: string,
  token: string,
  fileId: string,
): Promise<DownloadResult> {
  assertSafeSegment(fileId, 'file id');

  const response = await undiciRequest(`${url}/api/v1/assets/files/${fileId}`, {
    headers: { token },
    dispatcher: agent,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    safeDestroyBody(response.body);

    throw new Error(`download failed: ${response.statusCode}`);
  }

  const mimeType = firstHeader(response.headers, 'content-type') ?? 'application/octet-stream';
  const size = Number(firstHeader(response.headers, 'content-length') ?? 0);

  return {
    mimeType,
    size,
    bytes: async () => new Uint8Array(await response.body.arrayBuffer()),
    stream: () => toWebStream(response.body),
  };
}

export type ProxyResult = {
  status: number;
  headers: Headers;
  stream(): ReadableStream<Uint8Array>;
};

export async function proxyHls(
  agent: Dispatcher,
  url: string,
  token: string,
  path: string,
  signal?: AbortSignal | undefined,
): Promise<ProxyResult> {
  assertSafeAssetPath(path, 'hls path');

  const response = await undiciRequest(`${url}/api/v1/assets/video/hls/${path}`, {
    headers: { token },
    dispatcher: agent,
    signal: signal ?? null,
  });

  return buildProxyResult(response, signal);
}

export type SitemapProxyOptions = {
  /** chunk source as received from the query string; core decides whether the source/page pair is valid */
  source?: string | undefined;
  /** chunk page as received from the query string */
  page?: string | undefined;
  /** the incoming request's Accept-Encoding, so stored gzip bytes pass through untouched */
  acceptEncoding?: string | undefined;
  /** the incoming request's If-None-Match, so core can answer 304 */
  ifNoneMatch?: string | undefined;
};

export async function proxySitemap(
  agent: Dispatcher,
  url: string,
  token: string,
  projectRef: string,
  sitemapId: string,
  options: SitemapProxyOptions,
  signal?: AbortSignal | undefined,
): Promise<ProxyResult> {
  assertSafeSegment(projectRef, 'project ref');
  assertSafeSegment(sitemapId, 'sitemap id');

  const search = new URLSearchParams();

  if (options.source !== undefined) {
    search.set('source', options.source);
  }

  if (options.page !== undefined) {
    search.set('page', options.page);
  }

  const query = search.size > 0 ? `?${search}` : '';
  const headers: Record<string, string> = { token };

  if (options.acceptEncoding) {
    headers['accept-encoding'] = options.acceptEncoding;
  }

  if (options.ifNoneMatch) {
    headers['if-none-match'] = options.ifNoneMatch;
  }

  const response = await undiciRequest(`${url}/api/v1/projects/${projectRef}/sitemaps/${sitemapId}${query}`, {
    headers,
    dispatcher: agent,
    signal: signal ?? null,
  });

  const result = buildProxyResult(response, signal);

  if (response.statusCode === 304) {
    safeDestroyBody(response.body);

    return { ...result, stream: emptyStream };
  }

  return result;
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function buildProxyResult(response: Dispatcher.ResponseData, signal: AbortSignal | undefined): ProxyResult {
  const headers = new Headers();

  for (const [key, value] of Object.entries(response.headers)) {
    if (!FORWARDED_PROXY_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== null && value !== undefined) {
      headers.set(key, value);
    }
  }

  return {
    status: response.statusCode,
    headers,
    stream: () => toWebStream(response.body, signal),
  };
}

function firstHeader(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = headers[key];

  return Array.isArray(v) ? v[0] : v;
}

function safeDestroyBody(body: Dispatcher.ResponseData['body']): void {
  try {
    body.on('error', () => {});
    body.destroy();
  } catch {
    // already destroyed
  }
}

function toWebStream(
  body: Dispatcher.ResponseData['body'],
  signal?: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  let closed = false;

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    signal?.removeEventListener('abort', cleanup);
    safeDestroyBody(body);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', cleanup);

      body.on('data', (chunk: Uint8Array) => {
        if (closed || signal?.aborted) {
          return;
        }

        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      });

      body.on('end', () => {
        if (closed || signal?.aborted) {
          return;
        }

        closed = true;
        signal?.removeEventListener('abort', cleanup);

        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      body.on('error', (err: Error) => {
        cleanup();

        if (err.name === 'AbortError') {
          try {
            controller.close();
          } catch {
            // already closed
          }

          return;
        }

        try {
          controller.error(err);
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
}
