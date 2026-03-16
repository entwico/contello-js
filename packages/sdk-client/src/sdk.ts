import type { DocumentNode, ExecutionResult, OperationDefinitionNode } from 'graphql';
import type { Client } from 'graphql-ws';
import { Observable, firstValueFrom } from 'rxjs';

import { getWrap } from './diagnostics';

export type Requester<C = any, E = unknown> = <R, V>(
  doc: DocumentNode,
  vars?: V,
  options?: C,
) => Promise<ExecutionResult<R, E>> | Observable<ExecutionResult<R, E>>;

export type GetSdk<T, C = any, E = unknown> = (requester: Requester<C, E>) => T;

export const createSdk = <T>(client: () => Client, getSdk: GetSdk<T>) => {
  return getSdk((doc: DocumentNode, vars?: any, options?: any) => {
    if (options) {
      console.warn('options are not supported yet');
    }

    const query = doc.loc?.source.body;

    if (!query) {
      throw new Error('No query provided');
    }

    if (vars && typeof vars !== 'object') {
      throw new Error('Variables must be an object');
    }

    const operationDef = doc.definitions.find((def) => def.kind === 'OperationDefinition') as
      | OperationDefinitionNode
      | undefined;

    if (!operationDef) {
      throw new Error('No operation definition found');
    }

    const kind = operationDef.operation;

    const execute = () => {
      const wsClient = client();
      const res = new Observable<any>((obs) => wsClient.subscribe({ query, variables: vars as any }, obs));

      return kind !== 'subscription' ? firstValueFrom(res) : res;
    };

    const wrapFn = getWrap();

    if (wrapFn && kind !== 'subscription') {
      return wrapFn(`sdk:${operationDef.name?.value ?? ''}`, execute);
    }

    return execute();
  }) as T;
};
