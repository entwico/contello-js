import { graphqlOperationAttributes } from '@contello/opentelemetry';
import type { OperationOptions } from './deadline';
import { wrap } from './telemetry';
import { transformVariables } from './transform-variables';
import type { OperationMap, Rpc } from './types';

type Variables = Record<string, unknown> | undefined;
type Options = OperationOptions | undefined;

export type RpcTransport = {
  /** Rejects when its connection is lost. */
  subscribe: <TData>(query: string, variables: Variables, options: Options) => AsyncIterable<TData>;
  /** Is sent again on the next connection. */
  subscribeWithRetry: <TData>(query: string, variables: Variables, options: Options) => AsyncIterable<TData>;
  /** The answer of a query or mutation; rejects when its connection is lost. */
  first: <TData>(query: string, variables: Variables, options: Options) => Promise<TData>;
};

export const RETRY_SUFFIX = 'WithRetry';

export function buildRpc<T extends OperationMap>(operations: T, transport: RpcTransport): Rpc<T> {
  const { subscribe, subscribeWithRetry, first } = transport;
  const rpc = {} as Record<string, (...args: any[]) => any>;

  for (const [name, def] of Object.entries(operations)) {
    if (def.kind === 'subscription') {
      const retryName = name + RETRY_SUFFIX;

      if (Object.hasOwn(operations, retryName)) {
        throw new Error(
          `@contello/client: operation "${retryName}" collides with the retrying method of subscription "${name}"`,
        );
      }

      rpc[name] = (variables: Variables, options: Options) =>
        subscribe<unknown>(def.document, transformVariables(variables), options);
      rpc[retryName] = (variables: Variables, options: Options) =>
        subscribeWithRetry<unknown>(def.document, transformVariables(variables), options);

      continue;
    }

    rpc[name] = (variables: Variables, options: Options) => {
      const vars = transformVariables(variables);

      return wrap(
        `rpc:${name}`,
        () => first<unknown>(def.document, vars, options),
        graphqlOperationAttributes(def.document, vars),
      );
    };
  }

  return rpc as Rpc<T>;
}
