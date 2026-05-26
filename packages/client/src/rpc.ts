import { firstAsync, mapAsync } from './async-iterable-utils';
import { wrap } from './diagnostics';
import { transformResponse } from './transform-response';
import { transformVariables } from './transform-variables';
import type { OperationMap, Rpc } from './types';

type Subscribe = <TData>(query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<TData>;

export function buildRpc<T extends OperationMap>(operations: T, subscribe: Subscribe): Rpc<T> {
  const rpc = {} as Record<string, (...args: any[]) => any>;

  for (const [name, def] of Object.entries(operations)) {
    if (def.kind === 'subscription') {
      rpc[name] = (variables?: Record<string, unknown>) =>
        mapAsync(subscribe<unknown>(def.document, transformVariables(variables)), transformResponse);
    } else {
      rpc[name] = (variables?: Record<string, unknown>) =>
        wrap(`rpc:${name}`, () =>
          firstAsync(mapAsync(subscribe<unknown>(def.document, transformVariables(variables)), transformResponse)),
        );
    }
  }

  return rpc as Rpc<T>;
}
