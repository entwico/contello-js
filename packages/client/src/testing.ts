import type { MaybePromise } from '@entwico/dash';

import type { ContelloClient } from './client';

export type FakeCall = {
  kind: 'subscribe' | 'execute';
  query: string;
  variables: Record<string, unknown> | undefined;
};

export type FakeContelloHandlers = {
  /**
   * What a subscription answers with. A plain value is its one message, after which it completes;
   * an `AsyncIterable` is passed on message by message, for a subscription that stays open. A
   * thrown error or a rejection fails the subscription.
   */
  subscribe?: ((query: string, variables: Record<string, unknown> | undefined) => MaybePromise<unknown>) | undefined;
  /**
   * What `execute` answers with. Without it `execute` answers with the first message of
   * `subscribe`, which is what the real client does.
   */
  execute?: ((query: string, variables: Record<string, unknown> | undefined) => MaybePromise<unknown>) | undefined;
};

export type FakeContelloClient = {
  /**
   * Stands in for a `ContelloClient`: `subscribe`, `execute`, `init`, `destroy` and `ping` work,
   * nothing else is there.
   */
  client: ContelloClient<any>;
  /** Every subscription that was iterated and every `execute`, in order. */
  calls: FakeCall[];
  /** The subscriptions that are open right now: iterated, and neither finished nor closed. */
  open(): number;
};

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | undefined)?.[Symbol.asyncIterator] === 'function';
}

/**
 * A `ContelloClient` without a server, for tests of code that reads through one: the handlers
 * answer what Contello would, and the calls are recorded.
 *
 * ```ts
 * const { client, calls } = createFakeContelloClient({
 *   subscribe: (_query, variables) => ({ source: articles.filter((article) => wanted(article, variables)) }),
 * });
 * ```
 */
export function createFakeContelloClient(handlers?: FakeContelloHandlers | undefined): FakeContelloClient {
  const calls: FakeCall[] = [];
  let open = 0;

  function subscribe<TData>(query: string, variables?: Record<string, unknown> | undefined): AsyncIterable<TData> {
    return {
      // like the real client, every iteration is a subscription of its own
      [Symbol.asyncIterator](): AsyncIterator<TData> {
        const doneResult: IteratorResult<TData> = { value: undefined, done: true };
        let messages: AsyncIterator<unknown> | undefined;
        let answered = false;
        let closed = false;

        calls.push({ kind: 'subscribe', query, variables });
        open++;

        const close = () => {
          if (closed) {
            return;
          }

          closed = true;
          open--;
        };

        const nextMessage = async (): Promise<IteratorResult<TData>> => {
          if (messages) {
            return (await messages.next()) as IteratorResult<TData>;
          }

          if (answered) {
            return doneResult;
          }

          const answer = await handlers?.subscribe?.(query, variables);

          answered = true;

          if (!isAsyncIterable(answer)) {
            return { value: answer as TData, done: false };
          }

          messages = answer[Symbol.asyncIterator]();

          return (await messages.next()) as IteratorResult<TData>;
        };

        return {
          async next(): Promise<IteratorResult<TData>> {
            if (closed) {
              return doneResult;
            }

            try {
              const result = await nextMessage();

              if (result.done === true) {
                close();
              }

              return closed ? doneResult : result;
            } catch (error) {
              close();

              throw error;
            }
          },
          async return(): Promise<IteratorResult<TData>> {
            close();
            await messages?.return?.();

            return doneResult;
          },
        };
      },
    };
  }

  async function execute<TData>(query: string, variables?: Record<string, unknown> | undefined): Promise<TData> {
    if (handlers?.execute) {
      calls.push({ kind: 'execute', query, variables });

      return (await handlers.execute(query, variables)) as TData;
    }

    const iterator = subscribe<TData>(query, variables)[Symbol.asyncIterator]();

    // the subscription it runs on is recorded as what the caller asked for
    calls.at(-1)!.kind = 'execute';

    try {
      const result = await iterator.next();

      if (result.done === true) {
        throw new Error('the fake contello client has no answer for this execute');
      }

      return result.value;
    } finally {
      await iterator.return?.();
    }
  }

  const client = {
    subscribe,
    execute,
    init: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    ping: () => Promise.resolve(),
  } as unknown as ContelloClient<any>;

  return { client, calls, open: () => open };
}

export type FakeSource<T extends { id: string }> = {
  /** The entities Contello holds; a test changes them to change what the next fetch answers. */
  entities: Map<string, T>;
  /** The `ids` of every fetch, `undefined` for a fetch of all. */
  fetched: (string[] | undefined)[];
  /** The `subscribe` handler of `createFakeContelloClient`. */
  subscribe: (query: string, variables: Record<string, unknown> | undefined) => { source: T[] };
};

/**
 * The entities of one model as a source subscription serves them: all of them, or the ones the
 * `ids` variable asks for, in one `{ source }` message.
 *
 * ```ts
 * const articles = createFakeSource([{ id: 'a', title: 'first' }]);
 * const { client } = createFakeContelloClient({ subscribe: articles.subscribe });
 *
 * articles.entities.set('a', { id: 'a', title: 'changed' });
 * ```
 */
export function createFakeSource<T extends { id: string }>(initial?: readonly T[] | undefined): FakeSource<T> {
  const entities = new Map((initial ?? []).map((entity) => [entity.id, entity]));
  const fetched: (string[] | undefined)[] = [];

  return {
    entities,
    fetched,
    subscribe(_query, variables) {
      const ids = variables?.['ids'] as string[] | undefined;

      fetched.push(ids);

      return { source: ids ? ids.flatMap((id) => entities.get(id) ?? []) : entities.values().toArray() };
    },
  };
}
