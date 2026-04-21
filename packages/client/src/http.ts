import { Agent, type Dispatcher, request as undiciRequest } from 'undici';

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
  const response = await undiciRequest(`${url}/api/v1/assets/video/hls/${path}`, {
    headers: { token },
    dispatcher: agent,
    signal: signal ?? null,
  });

  return buildProxyResult(response, signal);
}

function buildProxyResult(response: Dispatcher.ResponseData, signal: AbortSignal | undefined): ProxyResult {
  const headers = new Headers();

  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value != null) {
      headers.set(key, String(value));
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
    if (!closed) {
      closed = true;
      signal?.removeEventListener('abort', cleanup);
      safeDestroyBody(body);
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', cleanup);

      body.on('data', (chunk: Uint8Array) => {
        if (!closed && !signal?.aborted) {
          try {
            controller.enqueue(chunk);
          } catch {
            cleanup();
          }
        }
      });

      body.on('end', () => {
        if (!closed && !signal?.aborted) {
          closed = true;
          signal?.removeEventListener('abort', cleanup);

          try {
            controller.close();
          } catch {
            // already closed
          }
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
