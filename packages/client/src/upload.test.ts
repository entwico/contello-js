import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { upload } from './upload';

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  private _listeners = new Map<string, Set<Listener>>();

  url: string;
  protocol: string;
  sent: unknown[] = [];
  bufferedAmount = 0;
  closed = false;

  constructor(url: string, protocol: string) {
    this.url = url;
    this.protocol = protocol;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this._listeners.get(type) ?? new Set();

    set.add(listener);
    this._listeners.set(type, set);
  }

  removeEventListener(): void {}

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    queueMicrotask(() => this.emit('close', {}));
  }

  emit(type: string, event: { data?: unknown }): void {
    const listeners = this._listeners.get(type) ?? [];

    for (const listener of listeners) {
      listener(event);
    }
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function only(): FakeWebSocket {
  expect(FakeWebSocket.instances).toHaveLength(1);

  return FakeWebSocket.instances[0]!;
}

describe('upload', () => {
  test('derives the ws url and sends an init frame on open', async () => {
    const promise = upload('https://cms.example', 'proj', 'tok', new Uint8Array([1, 2]), { name: 'a.png' });
    const ws = only();

    expect(ws.url).toBe('wss://cms.example/api/v1/assets/ws');
    expect(ws.protocol).toBe('contello-file-upload-v1');

    ws.emit('open', {});

    const init = JSON.parse(String(ws.sent[0]));

    expect(init).toMatchObject({
      type: 'init',
      token: 'tok',
      metadata: { name: 'a.png', size: 2, projectRef: 'proj' },
    });

    ws.emit('message', { data: JSON.stringify({ type: 'ack' }) });
    ws.emit('message', { data: JSON.stringify({ type: 'done', id: 'asset-1' }) });

    await expect(promise).resolves.toBe('asset-1');
    expect(ws.closed).toBe(true);
  });

  test('sends buffered chunks then a done marker after ack', async () => {
    const promise = upload('https://cms.example', 'proj', 'tok', new Uint8Array([1, 2, 3, 4, 5]), { name: 'a' }, {
      chunkSize: 2,
    });
    const ws = only();

    ws.emit('open', {});
    ws.emit('message', { data: JSON.stringify({ type: 'ack' }) });

    const chunks = ws.sent.slice(1);
    const dataChunks = chunks.filter((c) => c instanceof Uint8Array) as Uint8Array[];

    expect(dataChunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(JSON.parse(String(chunks.at(-1)))).toEqual({ type: 'done' });

    ws.emit('message', { data: JSON.stringify({ type: 'done', id: 'x' }) });

    await expect(promise).resolves.toBe('x');
  });

  test('rejects when the socket closes before completion', async () => {
    const promise = upload('https://cms.example', 'proj', 'tok', new Uint8Array([1]), { name: 'a' });
    const ws = only();

    ws.emit('open', {});
    ws.emit('close', {});

    await expect(promise).rejects.toThrow('connection closed before upload completed');
  });

  test('rejects on a socket error', async () => {
    const promise = upload('https://cms.example', 'proj', 'tok', new Uint8Array([1]), { name: 'a' });
    const ws = only();

    ws.emit('error', {});

    await expect(promise).rejects.toThrow('upload websocket error');
  });

  test('rejects and closes the socket when aborted mid-flight', async () => {
    const controller = new AbortController();
    const promise = upload('https://cms.example', 'proj', 'tok', new Uint8Array([1]), { name: 'a' }, {
      abort: controller.signal,
    });
    const ws = only();

    ws.emit('open', {});
    controller.abort();

    await expect(promise).rejects.toThrow('upload aborted');
    expect(ws.closed).toBe(true);
  });

  test('streams a ReadableStream body chunk by chunk', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9]));
        controller.enqueue(new Uint8Array([8]));
        controller.close();
      },
    });

    const promise = upload('https://cms.example', 'proj', 'tok', stream, { name: 'a', size: 3 });
    const ws = only();

    ws.emit('open', {});

    const init = JSON.parse(String(ws.sent[0]));

    expect(init.metadata.size).toBe(3);

    ws.emit('message', { data: JSON.stringify({ type: 'ack' }) });

    await vi.waitFor(() => {
      expect(JSON.parse(String(ws.sent.at(-1)))).toEqual({ type: 'done' });
    });

    const dataChunks = ws.sent.slice(1).filter((c) => c instanceof Uint8Array) as Uint8Array[];

    expect(dataChunks.map((c) => [...c])).toEqual([[9, 9], [8]]);

    ws.emit('message', { data: JSON.stringify({ type: 'done', id: 'streamed' }) });

    await expect(promise).resolves.toBe('streamed');
  });
});
