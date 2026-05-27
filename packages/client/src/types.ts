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

/**
 * Discriminator for how a SourceDef binds to a Subscription field:
 * - `entity` — a Contello entity model collection (`categoriesBatch` etc.), accepts optional `{ ids }` filter
 * - `singleton` — a single Contello entity (`config` etc.), no args
 * - `route` — built-in: `contelloRoutesBatch`, optional `{ ids, paths }` filter
 * - `asset` — built-in: `contelloAssetsBatch`, optional `{ ids }` filter
 * - `i18nMessage` — built-in: `contelloI18nMessagesBatch`, requires `{ collection }` and optional `{ ids }` filter
 */
export type SourceCardinality = 'entity' | 'singleton' | 'route' | 'asset' | 'i18nMessage';

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

export type SourceMap = Record<string, SourceDef>;

/**
 * The bundle emitted by `contello-client generate`. Pass to `createContelloClient({ schema })`
 * (and to `createStore`, `createContello`). Each layer reads what it needs:
 * - client uses `operations` (for `client.rpc.*`) and `sources` (for `client.sources.*`).
 * - store uses `models` (for the dependency resolver) on top of what client uses.
 */
export type Schema<
  TOps extends OperationMap = OperationMap,
  TSources extends SourceMap = SourceMap,
  TModels extends string = string,
> = {
  operations: TOps;
  sources: TSources;
  models: Record<TModels, string>;
};

type SourceFetcherFor<S> =
  S extends SourceDef<string, 'singleton', infer R>
    ? () => Promise<R>
    : S extends SourceDef<string, 'entity', infer R>
      ? (vars?: { ids?: string[] }) => Promise<R[]>
      : S extends SourceDef<string, 'route', infer R>
        ? (vars?: { ids?: string[] | undefined; paths?: string[] | undefined } | undefined) => Promise<R[]>
        : S extends SourceDef<string, 'asset', infer R>
          ? (vars?: { ids?: string[] | undefined } | undefined) => Promise<R[]>
          : S extends SourceDef<string, 'i18nMessage', infer R>
            ? (vars: { collection: string; ids?: string[] | undefined }) => Promise<R[]>
            : never;

/** Per-source runtime accessor: `client.sources.category.fetch()` → `Promise<CategoryFragment[]>` etc. */
export type SourceAccessors<TSources extends SourceMap> = {
  [K in keyof TSources]: { fetch: SourceFetcherFor<TSources[K]> };
};
