import { type Observable, firstValueFrom, map } from 'rxjs';

import { wrap } from './diagnostics';
import { transformResponse } from './transform-response';
import type { OperationMap, Rpc } from './types';

type RawClient = {
  subscribe<TData>(query: string, variables?: Record<string, unknown> | undefined): Observable<TData>;
};

export function buildRpc<T extends OperationMap>(operations: T, client: RawClient): Rpc<T> {
  const rpc = {} as Record<string, (...args: any[]) => any>;

  for (const [name, def] of Object.entries(operations)) {
    if (def.kind === 'subscription') {
      rpc[name] = (variables?: Record<string, unknown>) =>
        client.subscribe(def.document, variables).pipe(map(transformResponse));
    } else {
      rpc[name] = (variables?: Record<string, unknown>) =>
        wrap(`rpc:${name}`, () =>
          firstValueFrom(client.subscribe(def.document, variables).pipe(map(transformResponse))),
        );
    }
  }

  return rpc as Rpc<T>;
}
