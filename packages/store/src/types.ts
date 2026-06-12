import type { ConnectionEvents, Schema, SourceCardinality, SourceDef } from '@contello/client';
import type { MaybePromise, ReadonlyDeep } from 'projected';
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
 */
export type RefreshKind = 'upstream-update' | 'ttl' | 'on-demand';

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

export type Collection<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<T> | undefined>;
  get(ids: readonly string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  refresh(): void;
};

export type CollectionSync<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<RefreshEvent>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<T> | undefined;
  get(ids: readonly string[]): ReadonlyArray<ReadonlyDeep<T>>;
  getAll(): ReadonlyArray<ReadonlyDeep<T>>;
  refresh(): void;
};

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
