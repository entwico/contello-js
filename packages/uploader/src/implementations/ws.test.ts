import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UploadAssetProgress } from '../upload-metadata';
import type { ContelloUploaderParams } from '../uploader';
import { uploadViaWebSocket } from './ws';

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  private _listeners: Record<string, Listener[]> = {};

  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  closed = false;

  constructor(
    public url: string,
    public protocol: string,
  ) {
    FakeWebSocket.instances.push(this);
  }

  private _emit(type: string, event: unknown) {
    const listeners = this._listeners[type] ?? [];

    for (const listener of listeners) {
      listener(event);
    }
  }

  addEventListener(type: string, listener: Listener) {
    const list = (this._listeners[type] ??= []);

    list.push(listener);
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this._emit('open', {});
  }

  emitMessage(data: unknown) {
    this._emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  emitError(error: unknown) {
    this._emit('error', error);
  }

  // the browser fires close asynchronously after close() — modelled as an explicit trigger
  emitClose() {
    this.close();
    this._emit('close', {});
  }
}

function params(overrides?: Partial<Required<ContelloUploaderParams>>): Required<ContelloUploaderParams> {
  return {
    url: 'https://example.com',
    project: 'proj',
    token: 'tok',
    transport: 'ws',
    chunkSize: 4 * 1024 * 1024,
    ...overrides,
  };
}

function subscribe(observable: ReturnType<typeof uploadViaWebSocket>) {
  const next: (UploadAssetProgress | { id: string })[] = [];
  const state: { error?: unknown; completed: boolean } = { completed: false };

  const subscription = observable.subscribe({
    next: (value) => {
      next.push(value);
    },
    error: (error) => (state.error = error),
    complete: () => (state.completed = true),
  });

  return { next, state, subscription };
}

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe('uploadViaWebSocket', () => {
  test('connects to the wss endpoint for https urls', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    expect(ws.url).toBe('wss://example.com/api/v1/assets/ws');
    expect(ws.protocol).toBe('contello-file-upload-v1');
  });

  test('connects to the ws endpoint for http urls', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    // eslint-disable-next-line unicorn/prefer-https -- exercises the plaintext-transport branch
    const insecureUrl = 'http://example.com';

    subscribe(uploadViaWebSocket(params({ url: insecureUrl }), new File(['x'], 'a.bin'), undefined, undefined));

    expect(FakeWebSocket.instances[0]!.url).toBe('ws://example.com/api/v1/assets/ws');
  });

  test('sends an init frame with merged metadata on open', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });

    subscribe(uploadViaWebSocket(params(), file, { generatePreview: true }, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();

    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: 'init',
      metadata: {
        generatePreview: true,
        projectRef: 'proj',
        name: 'photo.png',
        mimeType: 'image/png',
        size: 5,
      },
      token: 'tok',
    });
  });

  test('streams a single chunk and completes with the asset id', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const { next, state } = subscribe(uploadViaWebSocket(params(), file, undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'ack' });

    await vi.waitFor(() => expect(ws.sent).toHaveLength(3));

    const [, chunk, doneFrame] = ws.sent;

    expect(chunk).toBeInstanceOf(ArrayBuffer);
    expect((chunk as ArrayBuffer).byteLength).toBe(5);
    expect(JSON.parse(doneFrame as string)).toEqual({ type: 'done' });

    ws.emitMessage({ type: 'progress', bytesReceived: 5 });
    ws.emitMessage({ type: 'done', id: 'asset-1' });

    expect(next).toEqual([{ progress: 100 }, { id: 'asset-1' }]);
    expect(state.completed).toBe(true);
    expect(ws.closed).toBe(true);
  });

  test('splits a large file into sequential chunks before signalling done', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const file = new File(['0123456789'], 'big.bin');
    subscribe(uploadViaWebSocket(params({ chunkSize: 4 }), file, undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'ack' });

    await vi.waitFor(() => expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: 'done' }));

    const binaryChunks = ws.sent.filter((frame): frame is ArrayBuffer => frame instanceof ArrayBuffer);

    expect(binaryChunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
  });

  test('reports progress relative to file size', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const file = new File(['0123456789'], 'big.bin');
    const { next } = subscribe(uploadViaWebSocket(params(), file, undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'progress', bytesReceived: 5 });

    expect(next).toEqual([{ progress: 50 }]);
  });

  test('errors when a done message carries no id', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { state } = subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'done', id: '' });

    expect((state.error as Error).message).toBe('No asset id received');
  });

  test('errors on an unknown message type and closes the socket', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { state } = subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'mystery' });

    expect((state.error as Error).message).toContain('unknown type');
    expect(ws.closed).toBe(true);
  });

  test('errors when a chunk is sent while the socket is not open', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { state } = subscribe(uploadViaWebSocket(params(), new File(['hello'], 'a.bin'), undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.readyState = FakeWebSocket.CLOSED;
    ws.emitMessage({ type: 'ack' });

    await vi.waitFor(() => expect((state.error as Error | undefined)?.message).toBe('WebSocket is closed'));
  });

  test('propagates socket errors', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { state } = subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const failure = new Error('socket boom');

    FakeWebSocket.instances[0]!.emitError(failure);

    expect(state.error).toBe(failure);
  });

  test('errors when the connection closes before completion', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { state } = subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    FakeWebSocket.instances[0]!.emitClose();

    expect((state.error as Error).message).toBe('Connection closed');
  });

  test('surfaces errors thrown while reading a slice', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const file = {
      name: 'a.bin',
      type: 'application/octet-stream',
      size: 10,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('read failed')) }),
    } as unknown as File;

    const { state } = subscribe(uploadViaWebSocket(params(), file, undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'ack' });

    await vi.waitFor(() => expect((state.error as Error | undefined)?.message).toBe('read failed'));
  });

  test('aborts an in-flight upload and errors', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const controller = new AbortController();
    const { state } = subscribe(
      uploadViaWebSocket(params(), new File(['hello'], 'a.bin'), undefined, { abort: controller.signal }),
    );

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    controller.abort();

    expect((state.error as Error).message).toBe('Upload aborted');
    expect(ws.closed).toBe(true);
  });

  test('skips sending further chunks once aborted between slices', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const controller = new AbortController();
    subscribe(uploadViaWebSocket(params({ chunkSize: 2 }), new File(['0123456789'], 'a.bin'), undefined, {
      abort: controller.signal,
    }));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'ack' });
    controller.abort();

    const sentBefore = ws.sent.length;

    await vi.waitFor(() => expect(ws.closed).toBe(true));

    expect(ws.sent.length).toBe(sentBefore);
  });

  test('closes the socket on unsubscribe', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { subscription } = subscribe(uploadViaWebSocket(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const ws = FakeWebSocket.instances[0]!;

    subscription.unsubscribe();

    expect(ws.closed).toBe(true);
  });
});
