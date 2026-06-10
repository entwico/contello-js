import { firstAsync } from './async-iterable-utils';
import { wrap } from './diagnostics';
import { transformVariables } from './transform-variables';
import type { OperationMap, Rpc } from './types';

type Subscribe = <TData>(query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<TData>;

export function buildRpc<T extends OperationMap>(operations: T, subscribe: Subscribe): Rpc<T> {
  const rpc = {} as Record<string, (...args: any[]) => any>;

  for (const [name, def] of Object.entries(operations)) {
    rpc[name] = def.kind === 'subscription' ? (variables?: Record<string, unknown>) =>
      subscribe<unknown>(def.document, transformVariables(variables)) : (variables?: Record<string, unknown>) =>
      wrap(`rpc:${name}`, () => firstAsync(subscribe<unknown>(def.document, transformVariables(variables))));
  }

  return rpc as Rpc<T>;
}
