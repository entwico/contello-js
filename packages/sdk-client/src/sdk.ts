import type { DocumentNode, ExecutionResult, OperationDefinitionNode } from 'graphql';
import type { Client } from 'graphql-ws';
import { Observable, firstValueFrom } from 'rxjs';
import type { ContelloSdkClientMiddleware } from './middleware';

export type Requester<C = any, E = unknown> = <R, V>(
  doc: DocumentNode,
  vars?: V,
  options?: C,
) => Promise<ExecutionResult<R, E>> | Observable<ExecutionResult<R, E>>;

export type GetSdk<T, C = any, E = unknown> = (requester: Requester<C, E>) => T;

export const createSdk = <T>(client: () => Client, middlewares: ContelloSdkClientMiddleware[], getSdk: GetSdk<T>) => {
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

    const executeRequest = () => {
      const wsClient = client();

      return new Observable<any>((obs) => wsClient.subscribe({ query, variables: vars as any }, obs));
    };

    const request = {
      kind,
      operationName: operationDef.name?.value ?? '',
      query,
      variables: vars || {},
    };

    const executeWithMiddlewares = (middlewares: ContelloSdkClientMiddleware[], index: number): Observable<any> => {
      if (index >= middlewares.length) {
        return executeRequest();
      }

      const middleware = middlewares[index];

      if (middleware?.onRequest) {
        return middleware.onRequest(request, () => executeWithMiddlewares(middlewares, index + 1));
      }

      return executeWithMiddlewares(middlewares, index + 1);
    };

    const res = executeWithMiddlewares(middlewares, 0);

    return kind !== 'subscription' ? firstValueFrom(res) : res;
  }) as T;
};
