import type { ConnectionEvents, Schema, SourceCardinality, SourceDef } from '@contello/client';
import type { MaybePromise, ReadonlyDeep } from '@entwico/dash';
import type { MapperContext } from './dependency-collector';

/** Extracts the typed fragment result from a SourceDef. */
export type ExtractSourceResult<S extends SourceDef<string, 'entity' | 'singleton'>> = NonNullable<S['__result']>;

/** Internal — every `create*` definer returns its instance plus a `destroy` the Store invokes on teardown. */
export type Created<T> = { instance: T; destroy: () => void };

/** Keys of `schema.sources` whose entries match the given cardinality. */
export type SourceKeysOf<TSchema, TCardinality extends SourceCardinality> = TSchema extends {
  sources: infer TSources;
}
  ? {
      [K in keyof TSources]: TSources[K] extends SourceDef<any, TCardinality, any> ? K : never;
    }[keyof TSources]
  : never;

/** The SourceDef at `schema.sources[TKey]`. */
export type SourceAt<TSchema, TKey> = TSchema extends { sources: infer TSources }
  ? TKey extends keyof TSources
    ? TSources[TKey]
    : never
  : never;

/**
 * For `define*(arg, options?)` — accepts either a string key (looked up in `schema.sources`) or a SourceDef directly.
 * `ResolveSource` projects the argument to the underlying SourceDef so `ExtractSourceResult`
 * can extract the fragment type.
 */
export type ResolveSource<TSchema, T> = T extends string
  ? SourceAt<TSchema, T>
  : T extends SourceDef<any, any, any>
    ? T
    : never;

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export type CreateStoreOptions<TSchema extends Schema | undefined = undefined> = {
  url: string;
  project: string;
  token: string;
  schema?: TSchema | undefined;
  connections?: number | undefined;
  onConnected?: (() => void) | undefined;
  onReconnecting?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  connectionEvents?: ConnectionEvents | undefined;
};

// ---------------------------------------------------------------------------
// refresh events
// ---------------------------------------------------------------------------

/**
 * What triggered a refresh:
 * - `'upstream-update'` — watcher event from the server (partial refresh on collection,
 *   full on singleton / i18n, cache eviction on lazy stores).
 * - `'ttl'` — periodic safety-net timer fired.
 * - `'on-demand'` — consumer called `instance.refresh()`.
 * - `'write'` — a `create` / `update` / `delete` on the collection itself; the watcher event
 *   for the same change still arrives afterwards and refreshes again.
 */
export type RefreshKind = 'upstream-update' | 'ttl' | 'on-demand' | 'write';

/** Refresh event shape for stores keyed by id (collection, lazy-collection, routes, assets, i18n). */
export type RefreshEvent = { ids: string[]; kind: RefreshKind };

/** Refresh event shape for stores with no id concept (singleton). */
export type SingletonRefreshEvent = { kind: RefreshKind };

// ---------------------------------------------------------------------------
// cache options
// ---------------------------------------------------------------------------

/** Cache options for non-lazy collections and singletons. */
export type CacheOptions = {
  /**
   * Periodic full refresh — guards against stale data from missed update events.
   * Defaults to 3 hours; set `0` or `false` to disable.
   */
  ttl?: number | false | undefined;
  /**
   * Controls how the cache responds to Contello update events.
   * `'refresh'` (default) serves stale data while a partial fetch runs in the background (SWR);
   * only the ids touched by the update are re-fetched, not the whole collection.
   * `'clear'` wipes the cache immediately so the next `get()` awaits the fresh result.
   * Note: the partial-refresh path is bypassed in `'clear'` mode.
   */
  eviction?: 'refresh' | 'clear' | undefined;
};

/**
 * Cache options for sync collections and singletons. `eviction` is omitted — clearing
 * the cache would break the sync guarantee.
 */
export type SyncCacheOptions = {
  /**
   * Periodic full refresh — guards against stale data from missed update events.
   * Defaults to 3 hours; set `0` or `false` to disable.
   */
  ttl?: number | false | undefined;
};

/** Cache options for lazy collections. */
export type LazyCacheOptions = {
  /** Maximum number of items kept in the LRU cache. Defaults to 1000. */
  max?: number | undefined;
  /**
   * Per-item LRU eviction — expired items are dropped on next access and
   * re-fetched lazily. Defaults to 3 hours; set `0` or `false` to disable.
   */
  ttl?: number | false | undefined;
};

// ---------------------------------------------------------------------------
// singleton
// ---------------------------------------------------------------------------

export type SingletonOptions<TRaw, TMapped, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  cache?: CacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: ((event: SingletonRefreshEvent) => void) | undefined;
};

export type SingletonSyncOptions<TRaw, TMapped, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  cache?: SyncCacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: ((event: SingletonRefreshEvent) => void) | undefined;
};

export type Loadable = {
  load(): Promise<void>;
};

export type Singleton<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<SingletonRefreshEvent>;
  load(): Promise<void>;
  get(): MaybePromise<ReadonlyDeep<T>>;
  refresh(): void;
};

export type SingletonSync<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<SingletonRefreshEvent>;
  load(): Promise<void>;
  get(): ReadonlyDeep<T>;
  refresh(): void;
};

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

export type CollectionOptions<TRaw, TMapped extends { id: string }, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  sort?: ((a: TMapped, b: TMapped) => number) | undefined;
  cache?: CacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type CollectionSyncOptions<TRaw, TMapped extends { id: string }, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  sort?: ((a: TMapped, b: TMapped) => number) | undefined;
  cache?: SyncCacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type Collection<T, TWrites = unknown> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<T> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  refresh(): void;
} & CollectionWrites<T, TWrites>;

export type CollectionSync<T, TWrites = unknown> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<T> | undefined;
  get(ids: readonly string[]): ReadonlyArray<ReadonlyDeep<T>>;
  getAll(): ReadonlyArray<ReadonlyDeep<T>>;
  refresh(): void;
} & CollectionWrites<T, TWrites>;

/** The phantom write-input shape a SourceDef carries, or `unknown` when it carries none. */
export type ExtractSourceWrites<S> = S extends SourceDef<string, SourceCardinality, any, infer TWrites>
  ? TWrites
  : unknown;

/** Everything the model's delete mutation accepts besides the id (e.g. `force`). */
export type DeleteOptions<TDelete> = Omit<TDelete, 'id'>;

/**
 * The write-input shape of the schema's built-in source of a given cardinality — `unknown` when
 * the app's documents carry no fragment for it, which is also when its writes cannot be typed.
 */
export type BuiltInWrites<TSchema, TCardinality extends SourceCardinality> = [
  SourceKeysOf<TSchema, TCardinality>,
] extends [never]
  ? unknown
  : ExtractSourceWrites<SourceAt<TSchema, SourceKeysOf<TSchema, TCardinality>>>;

/**
 * The write half of a source-backed store — collections, routes, assets: one method per mutation
 * the schema defines for it, so a model without a `createX` has no `create` here, and an asset
 * (which comes into being through `client.upload()`) has no `create` at all. Whether the token
 * may run them is the server's call — it answers a write it does not allow with an error, like
 * any other request.
 *
 * Writes are expressed in the model's raw input types, not in the mapped shape: `map()` is
 * one-way, so there is no way back from `T` to what the server accepts. What comes back is
 * mapped — `create` and `update` answer with the entity as the collection sees it.
 *
 * `update` is a patch: attributes left out keep their stored value, per property and, for
 * translatable ones, per locale.
 */
export type CollectionWrites<TMapped, TWrites> = (TWrites extends { create: infer TCreate }
  ? { create(input: TCreate): Promise<ReadonlyDeep<TMapped>> }
  : Record<never, never>)
& (TWrites extends { update: infer TUpdate }
  ? { update(input: TUpdate): Promise<ReadonlyDeep<TMapped>> }
  : Record<never, never>)
& (TWrites extends { delete: infer TDelete }
  ? { delete(id: string, options?: DeleteOptions<TDelete> | undefined): Promise<void> }
  : Record<never, never>);

// ---------------------------------------------------------------------------
// lazy collection
// ---------------------------------------------------------------------------

export type LazyCollectionOptions<TRaw, TMapped extends { id: string }, TModels extends string = string> = {
  name?: string | undefined;
  cache?: LazyCacheOptions | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type LazyCollection<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<RefreshEvent>;
  get(id: string): MaybePromise<ReadonlyDeep<T> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  refresh(): void;
  clear(): void;
};
