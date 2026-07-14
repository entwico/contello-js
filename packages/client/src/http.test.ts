import { afterEach, describe, expect, test, vi } from 'vitest';

import { createHttpAgent, downloadFile, proxyHls } from './http';

const request = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  Agent: class {
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
    }
  },
  request,
}));

type FakeBody = {
  on: (event: string, listener: () => void) => void;
  destroy: () => void;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function createBody(bytes = new Uint8Array()): FakeBody {
  return {
    on: vi.fn(),
    destroy: vi.fn(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const agent = {} as never;

afterEach(() => {
  request.mockReset();
});

describe('createHttpAgent', () => {
  test('applies defaults', () => {
    const { options } = createHttpAgent() as unknown as { options: Record<string, unknown> };

    expect(options['pipelining']).toBe(10);
    expect(options['allowH2']).toBe(true);
    expect(options['maxConcurrentStreams']).toBe(128);
    expect(options['keepAliveTimeout']).toBe(60_000);
  });

  test('respects overrides', () => {
    const { options } = createHttpAgent({ pipelining: 1, allowH2: false }) as unknown as {
      options: Record<string, unknown>;
    };

    expect(options['pipelining']).toBe(1);
    expect(options['allowH2']).toBe(false);
  });
});

describe('downloadFile', () => {
  test('rejects an unsafe file id before making a request', async () => {
    await expect(downloadFile(agent, 'http://host', 't', '../secret')).rejects.toThrow('invalid file id');
    expect(request).not.toHaveBeenCalled();
  });

  test('returns metadata and buffered bytes on success', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    request.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'image/png', 'content-length': '3' },
      body: createBody(bytes),
    });

    const result = await downloadFile(agent, 'http://host', 'tok', 'file1');

    expect(request).toHaveBeenCalledWith('http://host/api/v1/assets/files/file1', {
      headers: { token: 'tok' },
      dispatcher: agent,
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(3);
    expect(await result.bytes()).toEqual(bytes);
  });

  test('falls back to octet-stream and zero size when headers are absent', async () => {
    request.mockResolvedValue({ statusCode: 200, headers: {}, body: createBody() });

    const result = await downloadFile(agent, 'http://host', 'tok', 'file1');

    expect(result.mimeType).toBe('application/octet-stream');
    expect(result.size).toBe(0);
  });

  test('takes the first value of a multi-valued content-type header', async () => {
    request.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': ['text/plain', 'text/html'] },
      body: createBody(),
    });

    const result = await downloadFile(agent, 'http://host', 'tok', 'file1');

    expect(result.mimeType).toBe('text/plain');
  });

  test('throws and destroys the body on a non-2xx status', async () => {
    const body = createBody();

    request.mockResolvedValue({ statusCode: 404, headers: {}, body });

    await expect(downloadFile(agent, 'http://host', 'tok', 'file1')).rejects.toThrow('download failed: 404');
    expect(body.destroy).toHaveBeenCalled();
  });
});

describe('proxyHls', () => {
  test('rejects an empty path', async () => {
    await expect(proxyHls(agent, 'http://host', 't', '')).rejects.toThrow('invalid hls path');
    expect(request).not.toHaveBeenCalled();
  });

  test('rejects a path with unsafe segments', async () => {
    await expect(proxyHls(agent, 'http://host', 't', 'a/../b')).rejects.toThrow('invalid hls path');
  });

  test('forwards only whitelisted headers and exposes the status', async () => {
    request.mockResolvedValue({
      statusCode: 206,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'content-range': 'bytes 0-1/2',
        'set-cookie': 'secret=1',
        'x-internal': 'nope',
      },
      body: createBody(),
    });

    const result = await proxyHls(agent, 'http://host', 'tok', 'video/index.m3u8');

    expect(request).toHaveBeenCalledWith('http://host/api/v1/assets/video/hls/video/index.m3u8', {
      headers: { token: 'tok' },
      dispatcher: agent,
      signal: null,
    });
    expect(result.status).toBe(206);
    expect(result.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(result.headers.get('content-range')).toBe('bytes 0-1/2');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('x-internal')).toBeNull();
  });

  test('appends multiple values for array-valued forwarded headers', async () => {
    request.mockResolvedValue({
      statusCode: 200,
      headers: { 'cache-control': ['no-cache', 'no-store'] },
      body: createBody(),
    });

    const result = await proxyHls(agent, 'http://host', 'tok', 'a');

    expect(result.headers.get('cache-control')).toBe('no-cache, no-store');
  });
});
