import type { ConnectionEvents, ContelloClient, OperationMap } from '@contello/client';
import type { MaybePromise } from 'projected';
import type { Observable } from 'rxjs';
import type { MapperContext } from './dependency-collector';

export type Fetchable<T> = MaybePromise<T> | Observable<T>;

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
   * `'refresh'` (default) serves stale data while a new fetch runs in the background (SWR).
   * `'clear'` wipes the cache immediately so the next `get()` awaits the fresh result.
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

export type SingletonDef<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped,
  TModels extends string = string,
> = {
  name?: string | undefined;
  model: TModel;
  fetch: (client: ContelloClient<TOps>) => MaybePromise<TRaw>;
  map: (item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>;
  cache?: CacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
};

export type SingletonSyncDef<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped,
  TModels extends string = string,
> = {
  name?: string | undefined;
  model: TModel;
  fetch: (client: ContelloClient<TOps>) => MaybePromise<TRaw>;
  map: (item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>;
  cache?: SyncCacheOptions | undefined;
  onLoad?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
};

export type Loadable = {
  load(): Promise<void>;
};

export type Singleton<T> = {
  readonly name: string;
  readonly refresh$: Observable<void>;
  load(): Promise<void>;
  get(): MaybePromise<T>;
  refresh(): void;
};

export type SingletonSync<T> = {
  readonly name: string;
  readonly refresh$: Observable<void>;
  load(): Promise<void>;
  get(): T;
  refresh(): void;
};

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

export type CollectionDef<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TModels extends string = string,
> = {
  name?: string | undefined;
  model: TModel;
  fetch: (client: ContelloClient<TOps>) => Fetchable<TRaw[]>;
  map: (item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>;
  cache?: CacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type CollectionSyncDef<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TModels extends string = string,
> = {
  name?: string | undefined;
  model: TModel;
  fetch: (client: ContelloClient<TOps>) => Fetchable<TRaw[]>;
  map: (item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>;
  cache?: SyncCacheOptions | undefined;
  onLoad?: ((ids: string[]) => void) | undefined;
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type Collection<T> = {
  readonly name: string;
  readonly refresh$: Observable<string[]>;
  load(): Promise<void>;
  get(id: string): MaybePromise<T | undefined>;
  get(ids: string[]): MaybePromise<T[]>;
  getAll(): MaybePromise<T[]>;
  refresh(): void;
};

export type CollectionSync<T> = {
  readonly name: string;
  readonly refresh$: Observable<string[]>;
  load(): Promise<void>;
  get(id: string): T | undefined;
  get(ids: string[]): T[];
  getAll(): T[];
  refresh(): void;
};

// ---------------------------------------------------------------------------
// lazy collection
// ---------------------------------------------------------------------------

export type LazyCollectionDef<
  TOps extends OperationMap | undefined,
  TModel extends string,
  TRaw,
  TMapped extends { id: string },
  TModels extends string = string,
> = {
  name?: string | undefined;
  model: TModel;
  cache?: LazyCacheOptions | undefined;
  fetch: (ids: string[], client: ContelloClient<TOps>) => Fetchable<TRaw[]>;
  map: (item: TRaw, ref: MapperContext<TModels>) => MaybePromise<TMapped>;
  onRefresh?: ((ids: string[]) => void) | undefined;
};

export type LazyCollection<T> = {
  readonly name: string;
  readonly refresh$: Observable<string[]>;
  get(id: string): MaybePromise<T | undefined>;
  get(ids: string[]): MaybePromise<T[]>;
};
