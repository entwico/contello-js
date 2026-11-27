import { afterEach, describe, expect, test, vi } from 'vitest';

import { ContelloClient } from './client';
import type { ContelloClientChildMethods, ContelloClientParentMethods } from './methods';
import { type FakeHost, createFakeHost } from './test-host';

const stubGlobal = (name: string, value: unknown) => vi.stubGlobal(name, value);

type Client = ContelloClient<{ locale: string }, ContelloClientChildMethods, ContelloClientParentMethods>;

function createClient(host: FakeHost): Client {
  return new ContelloClient(host.origin, host.channelId, 'project-1', false);
}

async function connectClient(host: FakeHost): Promise<Client> {
  const client = createClient(host);

  host.answer('connect', () => ({ connected: true, data: { locale: 'de' } }));

  await client.connect();

  return client;
}

function stubDocument(body: { scrollHeight: number; offsetHeight: number; clientHeight: number }) {
  const resize = { notify: () => {}, observed: [] as unknown[] };
  const documentElement = {};

  vi.stubGlobal('document', { body, documentElement });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize.notify = callback;
      }

      observe(target: unknown) {
        resize.observed.push(target);
      }
    },
  );

  return { resize, documentElement };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContelloClient handshake', () => {
  test('connect() takes the data the host hands over', async () => {
    const host = createFakeHost(stubGlobal);
    const client = createClient(host);

    expect(client.data).toBeUndefined();

    host.answer('connect', () => ({ connected: true, data: { locale: 'de' } }));

    await client.connect();

    expect(client.data).toEqual({ locale: 'de' });
  });

  test('ready() reports the document height and every later resize', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);
    const body = { scrollHeight: 300, offsetHeight: 280, clientHeight: 120 };
    const { resize, documentElement } = stubDocument(body);

    host.answer('ready', () => ({}));

    await client.ready();

    expect(host.payloads('ready')).toEqual([{ height: 300 }]);
    expect(resize.observed).toEqual([documentElement]);

    body.offsetHeight = 640;
    resize.notify();

    expect(host.payloads('resize')).toEqual([{ height: 640 }]);
  });

  test('getAuthToken() answers with the token of the host', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);

    host.answer('getAuthToken', () => ({ token: 'secret' }));

    await expect(client.getAuthToken()).resolves.toBe('secret');
  });

  test('navigate() and displayNotification() pass their arguments to the host', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);

    host.answer('navigate', () => ({}));
    host.answer('displayNotification', () => ({}));

    await client.navigate('/somewhere');
    await client.displayNotification('error', 'it broke');

    expect(host.payloads('navigate')).toEqual([{ url: '/somewhere' }]);
    expect(host.payloads('displayNotification')).toEqual([{ type: 'error', message: 'it broke' }]);
  });
});

describe('ContelloClient urls', () => {
  const base = 'https://contello.example.com/ui/projects/project-1';

  test('project and singleton entity urls', () => {
    const client = createClient(createFakeHost(stubGlobal));

    expect(client.createProjectUrl()).toBe(base);
    expect(client.createSingletonEntityUrl('settings')).toBe(`${base}/entities/settings`);
  });

  test('entity detail urls for every mode', () => {
    const client = createClient(createFakeHost(stubGlobal));

    expect(client.createEntityDetailUrl('article', { mode: 'create' })).toBe(`${base}/entities/article/create`);
    expect(client.createEntityDetailUrl('article', { mode: 'edit', id: '7' })).toBe(`${base}/entities/article/edit/7`);
    expect(client.createEntityDetailUrl('article', { mode: 'clone', id: '7' })).toBe(`${base}/entities/article/clone/7`);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the alias is still part of the api
    expect(client.createEntityUrl('article', '7')).toBe(`${base}/entities/article/edit/7`);
  });

  test('extension urls with optional path and query', () => {
    const client = createClient(createFakeHost(stubGlobal));

    expect(client.createExtensionUrl('reports')).toBe(`${base}/extensions/reports`);
    expect(client.createExtensionUrl('reports', { path: ['2026', 'q1'] })).toBe(`${base}/extensions/reports/2026/q1`);
    expect(client.createExtensionUrl('reports', { query: { sort: 'a b' } })).toBe(`${base}/extensions/reports?sort=a+b`);
    expect(client.createExtensionUrl('reports', { path: ['x'], query: { y: 'z' } })).toBe(
      `${base}/extensions/reports/x?y=z`,
    );
  });
});

describe('ContelloClient.openDialog', () => {
  test('opens the dialog at the host and takes its id', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);

    host.answer('openDialog', () => ({ id: 'dialog-1' }));

    const dialog = client.openDialog({ url: '/dialog', width: 400, data: { articleId: '7' } });

    expect(dialog.id).toBeUndefined();

    await dialog.open;

    expect(dialog.id).toBe('dialog-1');
    expect(host.payloads('openDialog')).toEqual([{ url: '/dialog', width: 400, data: { articleId: '7' } }]);
  });

  test('follows the lifecycle events of its own dialog', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);
    const stages: string[] = [];

    host.answer('openDialog', () => ({ id: 'dialog-1' }));

    const dialog = client.openDialog<void, { saved: boolean }>({ url: '/dialog' });

    void dialog.connected.then(() => void stages.push('connected'));
    void dialog.ready.then(() => void stages.push('ready'));
    void dialog.complete.then((value) => void stages.push(`complete:${String(value.saved)}`));

    await dialog.open;

    await host.call('dialogConnect', { id: 'another-dialog' });
    await host.call('dialogReady', { id: 'another-dialog' });
    await host.call('dialogComplete', { id: 'another-dialog', value: { saved: false } });

    expect(stages).toEqual([]);

    await host.call('dialogConnect', { id: 'dialog-1' });
    await host.call('dialogReady', { id: 'dialog-1' });
    await host.call('dialogComplete', { id: 'dialog-1', value: { saved: true } });

    await vi.waitFor(() => expect(stages).toEqual(['connected', 'ready', 'complete:true']));
  });

  test('two dialogs complete independently', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);
    let opened = 0;

    host.answer('openDialog', () => ({ id: `dialog-${++opened}` }));

    const first = client.openDialog<void, string>({ url: '/first' });
    const second = client.openDialog<void, string>({ url: '/second' });

    await Promise.all([first.open, second.open]);

    await host.call('dialogComplete', { id: second.id, value: 'second' });

    await expect(second.complete).resolves.toBe('second');

    await host.call('dialogComplete', { id: first.id, value: 'first' });

    await expect(first.complete).resolves.toBe('first');
  });

  test('close() asks the host to close the dialog and stops following it', async () => {
    const host = createFakeHost(stubGlobal);
    const client = await connectClient(host);
    const completed = vi.fn();

    host.answer('openDialog', () => ({ id: 'dialog-1' }));
    host.answer('closeDialog', () => ({}));

    const dialog = client.openDialog({ url: '/dialog' });

    void dialog.complete.then(completed);

    await dialog.open;

    dialog.close();

    expect(host.payloads('closeDialog')).toEqual([{ id: 'dialog-1' }]);

    await host.call('dialogComplete', { id: 'dialog-1', value: 'late' });
    await Promise.resolve();

    expect(completed).not.toHaveBeenCalled();
  });
});
