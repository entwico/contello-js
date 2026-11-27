import { graphqlOperationAttributes } from '@contello/opentelemetry';
import { firstAsync } from '@entwico/dash/async';
import { wrap } from './telemetry';
import { transformVariables } from './transform-variables';
import type { OperationMap, Rpc } from './types';

type Subscribe = <TData>(query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<TData>;

export type RpcTransport = {
  /** Rejects when its connection is lost. */
  subscribe: Subscribe;
  /** Is sent again on the next connection. */
  subscribeWithRetry: Subscribe;
};

export const RETRY_SUFFIX = 'WithRetry';

export function buildRpc<T extends OperationMap>(operations: T, transport: RpcTransport): Rpc<T> {
  const { subscribe, subscribeWithRetry } = transport;
  const rpc = {} as Record<string, (...args: any[]) => any>;

  for (const [name, def] of Object.entries(operations)) {
    if (def.kind === 'subscription') {
      const retryName = name + RETRY_SUFFIX;

      if (Object.hasOwn(operations, retryName)) {
        throw new Error(
          `@contello/client: operation "${retryName}" collides with the retrying method of subscription "${name}"`,
        );
      }

      rpc[name] = (variables?: Record<string, unknown>) =>
        subscribe<unknown>(def.document, transformVariables(variables));
      rpc[retryName] = (variables?: Record<string, unknown>) =>
        subscribeWithRetry<unknown>(def.document, transformVariables(variables));

      continue;
    }

    rpc[name] = (variables?: Record<string, unknown>) => {
      const vars = transformVariables(variables);

      return wrap(
        `rpc:${name}`,
        () => firstAsync(subscribe<unknown>(def.document, vars)),
        graphqlOperationAttributes(def.document, vars),
      );
    };
  }

  return rpc as Rpc<T>;
}
