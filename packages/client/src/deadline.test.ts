import { closeTestServers, onCloseTestServers } from '@entwico/dash/testing/node';
import { afterEach, describe, expect, test } from 'vitest';

import { ContelloClient } from './client';
import { ContelloTimeoutError } from './deadline';
import { ENTITY_COUNT, startContello, until } from './test-servers';

afterEach(closeTestServers);

type Entities = { entities: { id: string }[] };

async function connectClient(port: number, operationTimeoutMs?: number | undefined): Promise<ContelloClient> {
  const client = new ContelloClient({
    url: `http://127.0.0.1:${port}`,
    project: 'test',
    token: 'token',
    operationTimeoutMs,
  });

  onCloseTestServers(() => client.destroy());
  await client.init();

  return client;
}

describe('an operation with a signal', () => {
  test('rejects an execute with the reason of the signal, and the connection goes on', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    const controller = new AbortController();

    const answer = client.execute('{ slow }', undefined, { signal: controller.signal });

    await until(() => contello.slowCalls() === 1);
    controller.abort(new Error('the request was cancelled'));

    await expect(answer).rejects.toThrow('the request was cancelled');
    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });
  });

  test('rejects an execute whose signal was aborted before the call', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    const signal = AbortSignal.abort(new Error('too late'));

    await expect(client.execute('{ greeting }', undefined, { signal })).rejects.toThrow('too late');
  });

  test('rejects the read of a collection and ends its stream on the server', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    const controller = new AbortController();

    const read = client.collect<Entities>('subscription { entities }', undefined, { signal: controller.signal });

    await until(() => contello.batchesSent() >= 5);
    controller.abort(new Error('the import was stopped'));

    await expect(read).rejects.toThrow('the import was stopped');

    // a round trip later the server has seen the end of the subscription
    await client.execute('{ greeting }');

    const sent = contello.batchesSent();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(contello.batchesSent()).toBeLessThanOrEqual(sent + 1);
  });

  test('rejects a subscription with the reason of the signal', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    const controller = new AbortController();

    const read = Array.fromAsync(
      client.subscribe<Entities>('subscription { entities }', undefined, { signal: controller.signal }),
    );

    await until(() => contello.batchesSent() >= 5);
    controller.abort(new Error('nobody listens'));

    await expect(read).rejects.toThrow('nobody listens');
  });
});

describe('a client with an operation timeout', () => {
  test('rejects an execute that got no answer in time', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port, 150);

    await expect(client.execute('{ slow }')).rejects.toBeInstanceOf(ContelloTimeoutError);
    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });
  });

  test('leaves a call with a signal of its own to that signal', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port, 150);

    const answer = client.execute('{ slow }', undefined, { signal: new AbortController().signal });

    await new Promise((resolve) => setTimeout(resolve, 400));
    contello.releaseSlow();

    await expect(answer).resolves.toEqual({ slow: 'answer 1' });
  });

  test('gives the read of a collection the time for each batch, not for all of them', async () => {
    const contello = await startContello();
    // the whole stream takes several times as long, a single batch a fraction
    const client = await connectClient(contello.port, 300);

    const batches = await client.collect<Entities>('subscription { entities }');

    expect(batches.flatMap((batch) => batch.entities)).toHaveLength(ENTITY_COUNT);
  });

  test('rejects the read of a collection whose batches stopped coming', async () => {
    const contello = await startContello({ stallAfterBatches: 5 });
    const client = await connectClient(contello.port, 150);

    await expect(client.collect<Entities>('subscription { entities }')).rejects.toBeInstanceOf(ContelloTimeoutError);
  });
});

describe('a client without an operation timeout', () => {
  test('waits for an answer for as long as it takes', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);

    const answer = client.execute('{ slow }');

    await new Promise((resolve) => setTimeout(resolve, 400));
    contello.releaseSlow();

    await expect(answer).resolves.toEqual({ slow: 'answer 1' });
  });
});
