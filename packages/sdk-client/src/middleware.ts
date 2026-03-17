import type { Observable } from 'rxjs';

export type ContelloSdkClientMiddleware = {
  onRequest?: (
    request: {
      kind: 'query' | 'mutation' | 'subscription';
      operationName: string;
      query: string;
      variables: Record<string, any>;
    },
    next: () => Observable<any>,
  ) => Observable<any>;

  onOutgoingMessage?: (message: any) => any;
};
