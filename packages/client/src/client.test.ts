import { afterEach, describe, expect, test, vi } from 'vitest';

import { ContelloClient } from './client';

// holds the payload the fake graphql-ws client will emit as `msg.data`
const emitted = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('graphql-ws', () => ({
  createClient: () => ({
    on: (event: string, cb: () => void) => {
      // resolve init()/destroy() immediately
      if (event === 'connected' || event === 'closed') {
        queueMicrotask(cb);
      }

      return () => {};
    },
    subscribe: (_payload: unknown, sink: { next: (m: { data: unknown }) => void; complete: () => void }) => {
      queueMicrotask(() => {
        sink.next({ data: emitted.data });
        sink.complete();
      });

      return () => {};
    },
    dispose: () => {},
  }),
}));

function createClient(): ContelloClient {
  return new ContelloClient({ url: 'http://localhost', project: 'p', token: 't' });
}

describe('ContelloClient transport-level response transform', () => {
  afterEach(() => {
    emitted.data = undefined;
  });

  test('execute() resolves flat component refs into nested arrays', async () => {
    emitted.data = {
      attributes: {
        content: [{ _flatId: 'a' }, { _flatId: 'b' }],
        _flat_content: [
          { _flatId: 'a', __typename: 'TextComponent', text: 'hello' },
          { _flatId: 'b', __typename: 'TextComponent', text: 'world' },
        ],
      },
    };

    const client = createClient();

    await client.init();

    const result = await client.execute<{ attributes: { content: { text: string }[] } }>('query { x }');

    expect(result.attributes.content).toHaveLength(2);
    expect(result.attributes.content[0]!.text).toBe('hello');
    expect(result.attributes.content[1]!.text).toBe('world');
    expect((result.attributes as Record<string, unknown>)['_flat_content']).toBeUndefined();

    await client.destroy();
  });

  test('execute() injects __model on entity and resolved components', async () => {
    emitted.data = {
      __typename: 'ProducerEntity',
      attributes: {
        contentSection1: [{ _flatId: 'a' }],
        _flat_contentSection1: [{ _flatId: 'a', __typename: 'SectionComponent', headline: 'hi' }],
      },
    };

    const client = createClient();

    await client.init();

    const result: any = await client.execute('query { x }');

    expect(result.__model).toBe('producer');
    expect(result.attributes.contentSection1[0].__model).toBe('section');
    expect(result.attributes.contentSection1[0].headline).toBe('hi');

    await client.destroy();
  });

  test('subscribe() transforms every emitted message (the path the store fetches through)', async () => {
    emitted.data = {
      source: [
        {
          __typename: 'ProducerEntity',
          id: '1',
          attributes: {
            contentSection1: [{ _flatId: 'x' }],
            _flat_contentSection1: [{ _flatId: 'x', __typename: 'TextComponent', text: 'deep' }],
          },
        },
      ],
    };

    const client = createClient();

    await client.init();

    let received: any;

    for await (const msg of client.subscribe<{ source: any[] }>('subscription { y }')) {
      received = msg;
      break;
    }

    const entity = received.source[0];

    expect(entity.__model).toBe('producer');
    expect(entity.attributes.contentSection1[0].text).toBe('deep');
    expect(entity.attributes.contentSection1[0].__model).toBe('text');
    expect(entity.attributes._flat_contentSection1).toBeUndefined();

    await client.destroy();
  });
});
