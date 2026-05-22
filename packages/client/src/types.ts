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
    ? () => AsyncIterable<InferResult<T>>
    : (variables: InferVariables<T>) => AsyncIterable<InferResult<T>>
  : InferVariables<T> extends Record<string, never>
    ? () => Promise<InferResult<T>>
    : (variables: InferVariables<T>) => Promise<InferResult<T>>;

export type Rpc<T extends OperationMap> = {
  [K in keyof T]: RpcMethod<T[K]>;
};

export type SourceCardinality = 'collection' | 'singleton';

export type SourceDef<
  TModel extends string = string,
  TCardinality extends SourceCardinality = SourceCardinality,
  TResult = unknown,
> = {
  /** the GQL fragment text — bundled with transitive deps if any */
  document: string;
  /** the fragment name to spread inside the source subscription — e.g. `Category` */
  fragment: string;
  /** the subscription field this fragment is bound to — `categoriesBatch`, `config`, etc */
  subscription: string;
  __model: TModel;
  __cardinality: TCardinality;
  /** phantom type — exists only at the type level */
  __result?: TResult | undefined;
};
