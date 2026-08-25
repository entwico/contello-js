import { type ContelloClient, type Schema, type SourceDef, createContelloClient } from '@contello/client';

import {
  type Assets,
  type AssetsOptions,
  type AssetsSync,
  type AssetsSyncOptions,
  createAssetsCollection,
  createAssetsSyncCollection,
} from './assets';
import { createCollection, createCollectionSync } from './collection';
import { type I18nMessageDef, type I18nMessages, createI18nMessagesCollection } from './i18n';
import { type LazyAssets, type LazyAssetsOptions, createLazyAssetsCollection } from './lazy-assets';
import { createLazyCollection } from './lazy-collection';
import { type LazyRoutes, type LazyRoutesOptions, createLazyRoutesCollection } from './lazy-routes';
import { ModelResolver } from './model-resolver';
import {
  type Routes,
  type RoutesOptions,
  type RoutesSync,
  type RoutesSyncOptions,
  createRoutesCollection,
  createRoutesSyncCollection,
} from './routes';
import { createSingleton, createSingletonSync } from './singleton';
import { wrap } from './telemetry';
import type {
  BuiltInWrites,
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  CreateStoreOptions,
  ExtractSourceResult,
  ExtractSourceWrites,
  LazyCollection,
  LazyCollectionOptions,
  ResolveSource,
  Singleton,
  SingletonOptions,
  SingletonSync,
  SingletonSyncOptions,
  SourceKeysOf,
} from './types';
import { type RefreshByTtlQueue, createRefreshByTtlQueue } from './utils';
import { type InternalWatcher, type UpdateBatch, createInternalWatcher } from './watcher';

/** Project the model-reference-name union out of a Schema generic, falling back to `string`. */
type ModelsOf<TSchema> = TSchema extends { models: infer M } ? keyof M & string : string;

type CollectionArg<TSchema> = SourceKeysOf<TSchema, 'entity'> | SourceDef<ModelsOf<TSchema>, 'entity'>;
type SingletonArg<TSchema> = SourceKeysOf<TSchema, 'singleton'> | SourceDef<ModelsOf<TSchema>, 'singleton'>;

type CollectionRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'entity'>>
>;
/** The write-input shape the source carries — `unknown` for sources the generator bound no mutations to. */
type CollectionWritesOf<TSchema, TArg> = ExtractSourceWrites<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'entity'>>
>;
type RouteWrites<TSchema> = BuiltInWrites<TSchema, 'route'>;
type AssetWrites<TSchema> = BuiltInWrites<TSchema, 'asset'>;
type SingletonRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'singleton'>>
>;

export class Store<TSchema extends Schema | undefined = undefined> {
  private _client: ContelloClient<TSchema>;
  private _resolver: ModelResolver;
  private _watcher: InternalWatcher;
  private _schema: TSchema;
  private _cleanups: (() => void)[] = [];
  private _refreshByTtl: RefreshByTtlQueue = createRefreshByTtlQueue();

  /**
   * Multicast update-batch stream from the watcher. Consume with `for await (const batch of updates$)`;
   * each iteration starts an independent fan-out from the shared source.
   */
  public readonly updates$: AsyncIterable<UpdateBatch>;

  public ping: () => Promise<void>;

  constructor(options: CreateStoreOptions<TSchema>) {
    const { url, project, token, schema } = options;

    this._schema = schema as TSchema;
    this._client = createContelloClient<TSchema>({
      url,
      project,
      token,
      schema,
      connections: options.connections,
      onConnected: options.onConnected,
      onReconnecting: options.onReconnecting,
      onError: options.onError,
      connectionEvents: options.connectionEvents,
    });

    this._resolver = new ModelResolver(schema?.models);
    this._watcher = createInternalWatcher(this._client, this._resolver);
    this.updates$ = this._watcher.updates$;
    this.ping = () => this._client.ping();
  }

  /** Resolve a string key (looked up via `schema.sources`) or a SourceDef directly to a SourceDef. */
  private _resolveSource<T extends SourceDef>(sourceOrKey: string | T): T {
    if (typeof sourceOrKey !== 'string') {
      return sourceOrKey;
    }

    const sources = (this._schema as Schema | undefined)?.sources;
    const source = sources?.[sourceOrKey];

    if (!source) {
      throw new Error(`@contello/store: no source named "${sourceOrKey}" in schema.sources`);
    }

    return source as T;
  }

  public get client(): ContelloClient<TSchema> {
    return this._client;
  }

  public async init() {
    await wrap('store:init', () => this._client.init());

    this._watcher.start();
  }

  public async destroy() {
    // eslint-disable-next-line unicorn/no-unnecessary-splice -- splice(0) is used for its return value (a snapshot of the cleanups) *and* to atomically empty the array; `.length = 0` would drop the returned snapshot we iterate
    for (const fn of this._cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // swallow — destruction is best-effort
      }
    }

    this._watcher.stop();

    await wrap('store:destroy', () => this._client.destroy());
  }

  // --- singleton ---

  public defineSingleton<TArg extends SingletonArg<TSchema>, TMapped = SingletonRaw<TSchema, TArg>>(
    sourceOrKey: TArg,
    options?: SingletonOptions<SingletonRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): Singleton<TMapped> {
    const source = this._resolveSource(sourceOrKey as string | SourceDef) as SourceDef<string, 'singleton'>;
    const { instance, destroy } = createSingleton(
      source,
      options as any,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as Singleton<TMapped>;
  }

  public defineSingletonSync<TArg extends SingletonArg<TSchema>, TMapped = SingletonRaw<TSchema, TArg>>(
    sourceOrKey: TArg,
    options?: SingletonSyncOptions<SingletonRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): SingletonSync<TMapped> {
    const source = this._resolveSource(sourceOrKey as string | SourceDef) as SourceDef<string, 'singleton'>;
    const { instance, destroy } = createSingletonSync(
      source,
      options as any,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as SingletonSync<TMapped>;
  }

  // --- collection ---

  public defineCollection<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: CollectionOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): Collection<TMapped, CollectionWritesOf<TSchema, TArg>> {
    const source = this._resolveSource(sourceOrKey as string | SourceDef) as SourceDef<string, 'entity'>;
    const { instance, destroy } = createCollection(
      source,
      options as any,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as unknown as Collection<TMapped, CollectionWritesOf<TSchema, TArg>>;
  }

  public defineCollectionSync<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: CollectionSyncOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): CollectionSync<TMapped, CollectionWritesOf<TSchema, TArg>> {
    const source = this._resolveSource(sourceOrKey as string | SourceDef) as SourceDef<string, 'entity'>;
    const { instance, destroy } = createCollectionSync(
      source,
      options as any,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as unknown as CollectionSync<TMapped, CollectionWritesOf<TSchema, TArg>>;
  }

  // --- lazy collection ---

  public defineLazyCollection<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: LazyCollectionOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): LazyCollection<TMapped> {
    const source = this._resolveSource(sourceOrKey as string | SourceDef) as SourceDef<string, 'entity'>;
    const { instance, destroy } = createLazyCollection(
      source,
      options as any,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );

    this._cleanups.push(destroy);

    return instance as LazyCollection<TMapped>;
  }

  // --- assets / routes / i18n (no source — built-ins) ---

  // --- assets ---

  public defineAssets(options?: AssetsOptions | undefined): Assets<AssetWrites<TSchema>> {
    const { instance, destroy } = createAssetsCollection(
      options,
      this._client,
      this._watcher.updates$,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as Assets<AssetWrites<TSchema>>;
  }

  public defineAssetsSync(options?: AssetsSyncOptions | undefined): AssetsSync<AssetWrites<TSchema>> {
    const { instance, destroy } = createAssetsSyncCollection(
      options,
      this._client,
      this._watcher.updates$,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as AssetsSync<AssetWrites<TSchema>>;
  }

  public defineLazyAssets(options?: LazyAssetsOptions | undefined): LazyAssets {
    const { instance, destroy } = createLazyAssetsCollection(options, this._client, this._watcher.updates$);

    this._cleanups.push(destroy);

    return instance;
  }

  // --- routes ---

  public defineRoutes(options?: RoutesOptions | undefined): Routes<RouteWrites<TSchema>> {
    const { instance, destroy } = createRoutesCollection(
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as Routes<RouteWrites<TSchema>>;
  }

  public defineRoutesSync(options?: RoutesSyncOptions | undefined): RoutesSync<RouteWrites<TSchema>> {
    const { instance, destroy } = createRoutesSyncCollection(
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
      this._refreshByTtl,
    );

    this._cleanups.push(destroy);

    return instance as RoutesSync<RouteWrites<TSchema>>;
  }

  public defineLazyRoutes(options?: LazyRoutesOptions | undefined): LazyRoutes {
    const { instance, destroy } = createLazyRoutesCollection(
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );

    this._cleanups.push(destroy);

    return instance;
  }

  public defineI18nMessages(def: I18nMessageDef): I18nMessages {
    const result = createI18nMessagesCollection(def, this._client, this._watcher.updates$, this._refreshByTtl);

    this._cleanups.push(result.destroy);

    return result;
  }
}

export function createStore<TSchema extends Schema | undefined = undefined>(
  options: CreateStoreOptions<TSchema>,
): Store<TSchema> {
  return new Store(options);
}
