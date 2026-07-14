import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UploadAssetProgress } from '../upload-metadata';
import type { ContelloUploaderParams } from '../uploader';
import { uploadViaXhr } from './xhr';

type Listener = (event: unknown) => void;

class FakeXhr {
  static instances: FakeXhr[] = [];

  private _listeners: Record<string, Listener> = {};
  private _uploadListeners: Record<string, Listener> = {};

  status = 0;
  statusText = '';
  responseText = '';
  method?: string;
  url?: string;
  body?: unknown;
  sent = false;
  aborted = false;
  opened = false;
  headers: Record<string, string> = {};

  upload = {
    addEventListener: (type: string, listener: Listener) => {
      this._uploadListeners[type] = listener;
    },
  };

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.opened = true;
  }

  setRequestHeader(key: string, value: string) {
    if (!this.opened) {
      throw new DOMException('setRequestHeader must be called after open', 'InvalidStateError');
    }

    this.headers[key] = value;
  }

  addEventListener(type: string, listener: Listener) {
    this._listeners[type] = listener;
  }

  send(body: unknown) {
    this.sent = true;
    this.body = body;
  }

  abort() {
    this.aborted = true;
  }

  emitUploadProgress(event: unknown) {
    this._uploadListeners['progress']?.(event);
  }

  emitLoad() {
    this._listeners['load']?.({});
  }

  emitError(error: unknown) {
    this._listeners['error']?.(error);
  }
}

function params(overrides?: Partial<Required<ContelloUploaderParams>>): Required<ContelloUploaderParams> {
  return {
    url: 'https://example.com',
    project: 'proj',
    token: 'tok',
    transport: 'http',
    chunkSize: 4 * 1024 * 1024,
    ...overrides,
  };
}

function subscribe(observable: ReturnType<typeof uploadViaXhr>) {
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
  FakeXhr.instances = [];
  vi.unstubAllGlobals();
});

describe('uploadViaXhr', () => {
  test('posts multipart form data with metadata and file to the assets endpoint', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });

    subscribe(uploadViaXhr(params(), file, { generatePreview: true }, undefined));

    const xhr = FakeXhr.instances[0]!;

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://example.com/api/v1/assets');
    expect(xhr.sent).toBe(true);
    expect(xhr.headers['Authorization']).toBe('Bearer tok');

    const body = xhr.body as FormData;

    expect(JSON.parse(body.get('metadata') as string)).toEqual({ generatePreview: true, projectRef: 'proj' });
    expect(body.get('file')).toBe(file);
  });

  test('opens the request before setting headers', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });

    const { state } = subscribe(uploadViaXhr(params(), file, {}, undefined));

    const xhr = FakeXhr.instances[0]!;

    expect(state.error).toBeUndefined();
    expect(xhr.opened).toBe(true);
    expect(xhr.headers['Authorization']).toBe('Bearer tok');
  });

  test('emits progress while the request body uploads', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { next } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    FakeXhr.instances[0]!.emitUploadProgress({ lengthComputable: true, loaded: 25, total: 50 });

    expect(next).toEqual([{ progress: 50 }]);
  });

  test('ignores progress events without a computable length', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { next } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    FakeXhr.instances[0]!.emitUploadProgress({ lengthComputable: false, loaded: 25, total: 50 });

    expect(next).toEqual([]);
  });

  test('emits the asset id and completes on a successful response', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { next, state } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const xhr = FakeXhr.instances[0]!;

    xhr.status = 201;
    xhr.responseText = JSON.stringify({ id: 'asset-9' });
    xhr.emitLoad();

    expect(next).toEqual([{ id: 'asset-9' }]);
    expect(state.completed).toBe(true);
  });

  test('errors with status and status text on a failed response', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { state } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const xhr = FakeXhr.instances[0]!;

    xhr.status = 500;
    xhr.statusText = 'Internal Server Error';
    xhr.emitLoad();

    expect((state.error as Error).message).toBe('500: Internal Server Error');
  });

  test('propagates transport errors', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { state } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    const failure = { message: 'network down' };

    FakeXhr.instances[0]!.emitError(failure);

    expect(state.error).toBe(failure);
  });

  test('aborts the request when the abort signal fires', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const controller = new AbortController();

    subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, { abort: controller.signal }));

    const xhr = FakeXhr.instances[0]!;

    expect(xhr.aborted).toBe(false);

    controller.abort();

    expect(xhr.aborted).toBe(true);
  });

  test('aborts the request on unsubscribe', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const { subscription } = subscribe(uploadViaXhr(params(), new File(['x'], 'a.bin'), undefined, undefined));

    subscription.unsubscribe();

    expect(FakeXhr.instances[0]!.aborted).toBe(true);
  });
});
