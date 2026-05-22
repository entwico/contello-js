import type { ConnectionEvents, OperationMap, SourceDef } from '@contello/client';
import type { MaybePromise, ReadonlyDeep } from 'projected';
import type { MapperContext } from './dependency-collector';

/** Extracts the typed fragment result from a SourceDef. */
export type ExtractSourceResult<S extends SourceDef<string, 'collection' | 'singleton'>> = NonNullable<S['__result']>;

/** Internal — every `create*` definer returns its instance plus a `destroy` the Store invokes on teardown. */
export type Created<T> = { instance: T; destroy: () => void };

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export type CreateStoreOptions<TOps extends OperationMap | undefined = undefined, TModels extends string = string> = {
  url: string;
  project: string;
  token: string;
  models?: Record<TModels, string> | undefined;
  operations?: TOps | undefined;
  connections?: number | undefined;
  onConnected?: (() => void) | undefined;
  onReconnecting?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  connectionEvents?: ConnectionEvents | undefined;
};

// ---------------------------------------------------------------------------
// cache options
// ---------------------------------------------------------------------------

/** Cache options for non-lazy collections and singletons. */
export type CacheOptions = {
  /** If set, the cache is refreshed automatically this many ms after each completed fetch. */
  ttl?: number | undefined;
  /**
   * Controls how the cache responds to Contello update events.
   * `'refresh'` (default) serves stale data while a partial fetch runs in the background (SWR);
   * only the ids touched by the update are re-fetched, not the whole collection.
   * `'clear'` wipes the cache immediately so the next `get()` awaits the fresh result.
   * Note: the partial-refresh path is bypassed in `'clear'` mode.
   */
  eviction?: 'refresh' | 'clear' | undefined;
};

/** Cache options for sync collections and singletons. `eviction` is omitted — clearing the cache would break the sync guarantee. */
export type SyncCacheOptions = {
  /** If set, the cache is refreshed automatically this many ms after each completed fetch. */
  ttl?: number | undefined;
};

/** Cache options for lazy collections. */
export type LazyCacheOptions = {
  /** Maximum number of items kept in the LRU cache. Defaults to 1000. */
  max?: number | undefined;
  /** Items are evicted from the LRU cache after this many ms. */
  ttl?: number | undefined;
};

// ---------------------------------------------------------------------------
// singleton
// ---------------------------------------------------------------------------

export type SingletonOptions<TRaw, TMapped, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  cache?: CacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
};

export type SingletonSyncOptions<TRaw, TMapped, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  cache?: SyncCacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
};

export type Loadable = {
  load(): Promise<void>;
};

export type Singleton<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<void>;
  load(): Promise<void>;
  get(): MaybePromise<ReadonlyDeep<T>>;
  refresh(): void;
};

export type SingletonSync<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<void>;
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
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type CollectionSyncOptions<TRaw, TMapped extends { id: string }, TModels extends string = string> = {
  name?: string | undefined;
  map?: ((item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>) | undefined;
  sort?: ((a: TMapped, b: TMapped) => number) | undefined;
  cache?: SyncCacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type Collection<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<string[]>;
  load(): Promise<void>;
  get(id: string): MaybePromise<ReadonlyDeep<T> | undefined>;
  get(ids: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  getAll(): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  refresh(): void;
};

export type CollectionSync<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<string[]>;
  load(): Promise<void>;
  get(id: string): ReadonlyDeep<T> | undefined;
  get(ids: string[]): ReadonlyArray<ReadonlyDeep<T>>;
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
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type LazyCollection<T> = {
  readonly name: string;
  readonly refresh$: AsyncIterable<string[]>;
  get(id: string): MaybePromise<ReadonlyDeep<T> | undefined>;
  get(ids: string[]): MaybePromise<ReadonlyArray<ReadonlyDeep<T>>>;
  refresh(): void;
  clear(): void;
};
