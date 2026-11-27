import type { OperationOptions } from './deadline';

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

type RpcOptions = OperationOptions | undefined;

/**
 * Variables first, then the options every operation takes. An operation without variables is
 * called with none, or with `undefined` in their place when it passes options.
 */
export type RpcMethod<T extends OperationDef> = T['kind'] extends 'subscription'
  ? InferVariables<T> extends Record<string, never>
    ? { (): AsyncIterable<InferResult<T>>; (variables: undefined, options: RpcOptions): AsyncIterable<InferResult<T>> }
    : (variables: InferVariables<T>, options?: RpcOptions) => AsyncIterable<InferResult<T>>
  : InferVariables<T> extends Record<string, never>
    ? { (): Promise<InferResult<T>>; (variables: undefined, options: RpcOptions): Promise<InferResult<T>> }
    : (variables: InferVariables<T>, options?: RpcOptions) => Promise<InferResult<T>>;

/**
 * One method per operation. A subscription has a second one, `<name>WithRetry`: the plain method
 * rejects when its connection is lost, this one is sent again on the next connection and goes on.
 */
export type Rpc<T extends OperationMap> = {
  [K in keyof T]: RpcMethod<T[K]>;
} & {
  [K in keyof T as T[K]['kind'] extends 'subscription' ? `${K & string}WithRetry` : never]: RpcMethod<T[K]>;
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

/**
 * One argument of a write mutation and what fills it. Entity mutations take a single input
 * object; the built-ins vary — `createContelloRoute` takes `route:`, `deleteContelloRoute`
 * takes a bare `id:`.
 */
export type SourceMutationArgument = {
  /** the GQL argument name — `request`, `route`, `id` */
  name: string;
  /** the rendered GQL type, including nullability — `CreateCategoryRequestInput!`, `String` */
  type: string;
  /** `input` takes the caller's input, `id` the id passed to a delete */
  from: 'input' | 'id';
  /** the argument is a list with one item per input of a batch write; an envelope wraps each of them */
  each?: boolean | undefined;
  /**
   * the single field of a one-field envelope argument (`CreateCategoryRequestInput { entity }`).
   * When set, the accessor takes the inner input and the runtime nests it under this key.
   */
  envelope?: string | undefined;
};

/**
 * What a write mutation answers with:
 * - `entity` — the entity itself, selected through the source's fragment
 * - `idObject` — an object carrying `id` (`ContelloEntityDeleteResponse`)
 * - `idScalar` — a bare id (`deleteContelloRoute: String!`)
 */
export type SourceMutationResult = 'entity' | 'idObject' | 'idScalar';

/**
 * How one write operation of a source binds to a Mutation field. Emitted by the generator
 * from introspection — the runtime never derives field or argument names by string munging.
 */
export type SourceMutationBinding = {
  /** the mutation field — `createCategory` */
  field: string;
  arguments: SourceMutationArgument[];
  result: SourceMutationResult;
};

/**
 * Mutation bindings of a source. Absent operations are simply missing (singletons have no
 * `create`, and no batch writes). The `*Many` kinds write a list of entities in one mutation.
 */
export type SourceMutations = {
  create?: SourceMutationBinding | undefined;
  update?: SourceMutationBinding | undefined;
  delete?: SourceMutationBinding | undefined;
  createMany?: SourceMutationBinding | undefined;
  updateMany?: SourceMutationBinding | undefined;
  deleteMany?: SourceMutationBinding | undefined;
};

/**
 * Phantom shape carrying the input types of a source's write operations. A key is present
 * only when the schema exposes the matching mutation, so `client.sources.x.create` exists
 * exactly when `createX` does. `createMany` and `updateMany` carry the type of one input.
 */
export type SourceWrites = {
  create?: unknown;
  update?: unknown;
  delete?: unknown;
  createMany?: unknown;
  updateMany?: unknown;
  deleteMany?: unknown;
};

export type SourceDef<
  TModel extends string = string,
  TCardinality extends SourceCardinality = SourceCardinality,
  TResult = unknown,
  TWrites = unknown,
> = {
  /** the GQL fragment text — bundled with transitive deps if any */
  document: string;
  /** the fragment name to spread inside the source subscription — e.g. `Category` */
  fragment: string;
  /** the subscription field this fragment is bound to — `categoriesBatch`, `config`, etc */
  subscription: string;
  /** write bindings — present only for sources whose model exposes entity mutations */
  mutations?: SourceMutations | undefined;
  __model: TModel;
  __cardinality: TCardinality;
  /** phantom type — exists only at the type level */
  __result?: TResult | undefined;
  /** phantom type — exists only at the type level */
  __writes?: TWrites | undefined;
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

type FetchOptions = OperationOptions | undefined;

/** What a list read is narrowed to, and the options of the call next to it. */
type Fetch<TFilter> = TFilter & OperationOptions;

type SourceFetcherFor<S> =
  S extends SourceDef<string, 'singleton', infer R>
    ? (options?: FetchOptions) => Promise<R>
    : S extends SourceDef<string, 'entity', infer R>
      ? (request?: Fetch<{ ids?: string[] | undefined }> | undefined) => Promise<R[]>
      : S extends SourceDef<string, 'route', infer R>
        ? (
            request?: Fetch<{ ids?: string[] | undefined; paths?: string[] | undefined }> | undefined,
          ) => Promise<R[]>
        : S extends SourceDef<string, 'asset', infer R>
          ? (request?: Fetch<{ ids?: string[] | undefined }> | undefined) => Promise<R[]>
          : S extends SourceDef<string, 'i18nMessage', infer R>
            ? (request: Fetch<{ collection: string; ids?: string[] | undefined }>) => Promise<R[]>
            : never;

/** Extracts the phantom write-input shape of a SourceDef. */
type WritesOf<S> = S extends SourceDef<string, SourceCardinality, any, infer W> ? W : unknown;

/** Extracts the phantom result shape of a SourceDef — what its fragment selects. */
type ResultOf<S> = S extends SourceDef<string, SourceCardinality, infer R, any> ? R : unknown;

/**
 * Per-source write accessors. Each method exists only when the generator found the matching
 * mutation. A `create`/`update` selects the source's own fragment, so it answers with the entity
 * in exactly the shape `fetch` yields; a `delete` answers with the id it removed. Nothing is
 * cached here — that is the job of the collection that owns the source in `@contello/store`.
 *
 * The `*Many` methods write a list in one mutation, which is rejected as a whole when it fails.
 * `updateMany` answers in the order of its inputs, and so does `createMany` when every input
 * carries an id; `deleteMany` answers with the ids it removed.
 */
type SourceWritersFor<S> = (WritesOf<S> extends { create: infer TCreate }
  ? { create: (input: TCreate, options?: FetchOptions) => Promise<ResultOf<S>> }
  : Record<never, never>)
& (WritesOf<S> extends { update: infer TUpdate }
  ? { update: (input: TUpdate, options?: FetchOptions) => Promise<ResultOf<S>> }
  : Record<never, never>)
& (WritesOf<S> extends { delete: infer TDelete }
  ? { delete: (input: TDelete, options?: FetchOptions) => Promise<string> }
  : Record<never, never>)
& (WritesOf<S> extends { createMany: infer TCreate }
  ? { createMany: (inputs: readonly TCreate[], options?: FetchOptions) => Promise<ResultOf<S>[]> }
  : Record<never, never>)
& (WritesOf<S> extends { updateMany: infer TUpdate }
  ? { updateMany: (inputs: readonly TUpdate[], options?: FetchOptions) => Promise<ResultOf<S>[]> }
  : Record<never, never>)
& (WritesOf<S> extends { deleteMany: infer TDelete }
  ? { deleteMany: (input: TDelete, options?: FetchOptions) => Promise<string[]> }
  : Record<never, never>);

/** Per-source runtime accessor: `client.sources.category.fetch()` → `Promise<CategoryFragment[]>` etc. */
export type SourceAccessors<TSources extends SourceMap> = {
  [K in keyof TSources]: { fetch: SourceFetcherFor<TSources[K]> } & SourceWritersFor<TSources[K]>;
};
