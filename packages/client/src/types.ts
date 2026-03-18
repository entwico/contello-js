import type { Observable } from 'rxjs';

export type OperationKind = 'query' | 'mutation' | 'subscription';

export type OperationDef<
  TResult = unknown,
  TVariables = Record<string, unknown>,
  TKind extends OperationKind = OperationKind,
> = {
  document: string;
  kind: TKind;
  /** phantom type — exists only at the type level */
  __result?: TResult | undefined;
  /** phantom type — exists only at the type level */
  __variables?: TVariables | undefined;
};

export type OperationMap = Record<string, OperationDef>;

export type InferResult<T extends OperationDef> = NonNullable<T['__result']>;
export type InferVariables<T extends OperationDef> = NonNullable<T['__variables']>;

export type RpcMethod<T extends OperationDef> = T['kind'] extends 'subscription'
  ? InferVariables<T> extends Record<string, never>
    ? () => Observable<InferResult<T>>
    : (variables: InferVariables<T>) => Observable<InferResult<T>>
  : InferVariables<T> extends Record<string, never>
    ? () => Promise<InferResult<T>>
    : (variables: InferVariables<T>) => Promise<InferResult<T>>;

export type Rpc<T extends OperationMap> = {
  [K in keyof T]: RpcMethod<T[K]>;
};
