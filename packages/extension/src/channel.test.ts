import { afterEach, describe, expect, test, vi } from 'vitest';

import { ExtensionChannel } from './channel';
import { type FakeHost, createFakeHost } from './test-host';

const stubGlobal = (name: string, value: unknown) => vi.stubGlobal(name, value);

type Remote = { greet: [{ name: string }, { text: string }]; silent: [void, void] };
type Own = { double: [{ value: number }, { value: number }] };

function connect(host: FakeHost, debug = false): ExtensionChannel<Own, Remote> {
  const channel = new ExtensionChannel<Own, Remote>({ debug });

  channel.connectParent(host.origin, host.channelId);

  return channel;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ExtensionChannel.call', () => {
  test('posts the request to the target origin and resolves with the answer', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    host.answer('greet', ({ name }) => ({ text: `hello ${name}` }));

    await expect(channel.call('greet', { name: 'ada' })).resolves.toEqual({ text: 'hello ada' });

    expect(host.requests).toEqual([
      { channelId: host.channelId, requestId: expect.stringMatching(/^child-request-/), method: 'greet', payload: { name: 'ada' } },
    ]);
    expect(host.targetOrigins).toEqual([host.origin]);
  });

  test('rejects with the error of the answer', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    host.answer('greet', () => {
      throw new Error('not allowed');
    });

    await expect(channel.call('greet', { name: 'ada' })).rejects.toBe('not allowed');
  });

  test('gives every request its own id and forgets it once answered', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    host.answer('greet', ({ name }) => ({ text: name }));

    const answers = await Promise.all([channel.call('greet', { name: 'a' }), channel.call('greet', { name: 'b' })]);

    expect(answers).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(new Set(host.requests.map((request) => request.requestId)).size).toBe(2);
    expect(channel.handlers.size).toBe(0);
  });

  test('an answer from another channel, window or origin does not settle the request', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);
    const settled = vi.fn();

    void channel.call('greet', { name: 'ada' }).then(settled);

    const { requestId } = host.requests[0]!;
    const answer = { requestId, method: 'greet', payload: { text: 'forged' } };

    host.deliver({ ...answer, channelId: 'another-channel' });
    host.deliver({ ...answer, channelId: host.channelId }, { source: {} });
    host.deliver({ ...answer, channelId: host.channelId }, { origin: 'https://evil.example.com' });
    host.deliver(undefined as never);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    host.deliver({ ...answer, channelId: host.channelId, payload: { text: 'genuine' } });

    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith({ text: 'genuine' }));
  });

  test('does not hear answers after disconnect()', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    expect(host.listeners()).toBe(1);

    channel.disconnect();

    expect(host.listeners()).toBe(0);
  });
});

describe('ExtensionChannel.on', () => {
  test('answers a request with what the handler returns', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    channel.on('double', ({ value }) => ({ value: value * 2 }));

    await expect(host.call('double', { value: 21 })).resolves.toEqual({ value: 42 });
  });

  test('awaits an async handler', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    channel.on('double', async ({ value }) => {
      await Promise.resolve();

      return { value: value * 2 };
    });

    await expect(host.call('double', { value: 4 })).resolves.toEqual({ value: 8 });
  });

  test('answers with the error a handler throws', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = connect(host);

    channel.on('double', () => {
      throw 'cannot double';
    });

    await expect(host.call('double', { value: 1 })).rejects.toBe('cannot double');
  });

  test('leaves a request for a method without a handler unanswered', async () => {
    const host = createFakeHost(stubGlobal);

    connect(host);

    const settled = vi.fn();

    void host.call('unknown').then(settled).catch(settled);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).not.toHaveBeenCalled();
    expect(host.targetOrigins).toEqual([]);
  });
});

describe('ExtensionChannel as the parent side', () => {
  test('talks to the child window and accepts any origin by default', async () => {
    const host = createFakeHost(stubGlobal);
    const channel = new ExtensionChannel<Own, Remote>({ debug: false });

    channel.connectChild(host.window);

    const answer = channel.call('greet', { name: 'child' });
    const request = host.requests[0]!;

    expect(request.requestId).toMatch(/^parent-request-/);
    expect(request.channelId).toBe(channel.getChannelId());
    expect(host.targetOrigins).toEqual(['*']);

    host.deliver({ ...request, payload: { text: 'hi' } }, { origin: 'https://anywhere.example.com' });

    await expect(answer).resolves.toEqual({ text: 'hi' });
  });

  test('keeps the channel id that was populated before the child connected', () => {
    const host = createFakeHost(stubGlobal);
    const channel = new ExtensionChannel<Own, Remote>({ debug: false });
    const channelId = channel.populateChannelId();

    expect(channelId).toMatch(/^contello-channel-/);
    expect(channel.populateChannelId()).toBe(channelId);

    channel.connectChild(host.window, 'https://child.example.com');

    expect(channel.getChannelId()).toBe(channelId);
    expect(channel.getTargetOrigin()).toBe('https://child.example.com');
    expect(channel.getTargetWindow()).toBe(host.window);
  });

  test('two channels get different ids', () => {
    const first = new ExtensionChannel({ debug: false }).populateChannelId();
    const second = new ExtensionChannel({ debug: false }).populateChannelId();

    expect(first).not.toBe(second);
  });
});

describe('ExtensionChannel debug', () => {
  test('logs received messages only in debug mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const host = createFakeHost(stubGlobal);
    const quiet = connect(host);

    host.answer('greet', () => ({ text: 'hi' }));

    await quiet.call('greet', { name: 'a' });

    expect(quiet.getIsDebug()).toBe(false);
    expect(log).not.toHaveBeenCalled();

    quiet.disconnect();

    const verbose = connect(host, true);

    await verbose.call('greet', { name: 'a' });

    expect(verbose.getIsDebug()).toBe(true);
    expect(log).toHaveBeenCalledWith('Child received', expect.objectContaining({ method: 'greet' }));
  });
});
