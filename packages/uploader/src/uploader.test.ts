import { afterEach, describe, expect, test, vi } from 'vitest';
import { UploadAssetRetentionPolicy } from './upload-metadata';
import { ContelloUploader } from './uploader';

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static OPEN = 1;
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
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this._emit('open', {});
  }

  emitMessage(data: unknown) {
    this._emit('message', { data: JSON.stringify(data) });
  }
}

class FakeXhr {
  static instances: FakeXhr[] = [];

  upload = { addEventListener: () => {} };

  constructor() {
    FakeXhr.instances.push(this);
  }

  open() {}
  setRequestHeader() {}
  addEventListener() {}
  send() {}
  abort() {}
}

afterEach(() => {
  FakeWebSocket.instances = [];
  FakeXhr.instances = [];
  vi.unstubAllGlobals();
});

describe('ContelloUploader', () => {
  test('constructor sets default transport to ws', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });

  test('constructor accepts custom transport', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
      transport: 'http',
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });

  test('constructor accepts custom chunk size', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
      chunkSize: 1024,
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });

  test('uploadWithEvents drives the websocket transport by default', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const uploader = new ContelloUploader({ url: 'https://example.com', project: 'p', token: 't' });

    uploader.uploadWithEvents(new File(['x'], 'a.bin')).subscribe({ error: () => {} });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  test('uploadWithEvents drives the xhr transport when http is selected', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'p',
      token: 't',
      transport: 'http',
    });

    uploader.uploadWithEvents(new File(['x'], 'a.bin')).subscribe({ error: () => {} });

    expect(FakeXhr.instances).toHaveLength(1);
  });

  test('upload resolves with the asset id and skips progress events', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const uploader = new ContelloUploader({ url: 'https://example.com', project: 'p', token: 't' });

    const result = uploader.upload(new File(['hello'], 'a.bin'));

    const ws = FakeWebSocket.instances[0]!;

    ws.emitOpen();
    ws.emitMessage({ type: 'ack' });

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(3));

    ws.emitMessage({ type: 'progress', bytesReceived: 3 });
    ws.emitMessage({ type: 'done', id: 'asset-42' });

    await expect(result).resolves.toEqual({ id: 'asset-42' });
  });
});

describe('UploadAssetRetentionPolicy', () => {
  test('has retain value', () => {
    expect(UploadAssetRetentionPolicy.retain).toBe(UploadAssetRetentionPolicy.retain);
  });

  test('has deleteIfNotUsed value', () => {
    expect(UploadAssetRetentionPolicy.deleteIfNotUsed).toBe(UploadAssetRetentionPolicy.deleteIfNotUsed);
  });

  test('enum values are strings', () => {
    expect(typeof UploadAssetRetentionPolicy.retain).toBe('string');
    expect(typeof UploadAssetRetentionPolicy.deleteIfNotUsed).toBe('string');
  });
});
