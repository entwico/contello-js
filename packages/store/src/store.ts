import { type ContelloClient, type OperationMap, type SourceDef, createContelloClient } from '@contello/client';
import type { Observable } from 'rxjs';

import { type AssetCollectionOptions, type Assets, createAssetsCollection } from './assets';
import { createCollection, createCollectionSync } from './collection';
import { wrap } from './diagnostics';
import { type I18nMessageDef, type I18nMessages, createI18nMessagesCollection } from './i18n';
import { createLazyCollection } from './lazy-collection';
import { ModelResolver } from './model-resolver';
import { type RouteCollectionOptions, type Routes, createRoutesCollection } from './routes';
import { createSingleton, createSingletonSync } from './singleton';
import type {
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  CreateStoreOptions,
  ExtractSourceResult,
  LazyCollection,
  LazyCollectionOptions,
  Singleton,
  SingletonOptions,
  SingletonSync,
  SingletonSyncOptions,
} from './types';
import { type InternalWatcher, type UpdateBatch, createInternalWatcher } from './watcher';

export class Store<TOps extends OperationMap | undefined = undefined, TModels extends string = string> {
  private _client: ContelloClient<TOps>;
  private _resolver: ModelResolver;
  private _watcher: InternalWatcher;

  public readonly updates$: Observable<UpdateBatch>;

  constructor(options: CreateStoreOptions<TOps, TModels>) {
    const { url, project, token, operations } = options;

    this._client = createContelloClient({
      url,
      project,
      token,
      operations,
      connections: options.connections,
      onConnected: options.onConnected,
      onReconnecting: options.onReconnecting,
      onError: options.onError,
      connectionEvents: options.connectionEvents,
    });

    this._resolver = new ModelResolver(options.models);
    this._watcher = createInternalWatcher(this._client, this._resolver);
    this.updates$ = this._watcher.updates$;
    this.ping = () => this._client.ping();
  }

  public async init() {
    await wrap('store:init', () => this._client.init());

    this._watcher.start();
  }

  public async destroy() {
    this._watcher.stop();

    await wrap('store:destroy', () => this._client.destroy());
  }

  public defineSingleton<TSource extends SourceDef<TModels, 'singleton'>, TMapped = ExtractSourceResult<TSource>>(
    source: TSource,
    options?: SingletonOptions<ExtractSourceResult<TSource>, TMapped, TModels>,
  ): Singleton<TMapped> {
    return createSingleton<TOps, TSource, TMapped, TModels>(
      source,
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );
  }

  public defineSingletonSync<TSource extends SourceDef<TModels, 'singleton'>, TMapped = ExtractSourceResult<TSource>>(
    source: TSource,
    options?: SingletonSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels>,
  ): SingletonSync<TMapped> {
    return createSingletonSync<TOps, TSource, TMapped, TModels>(
      source,
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );
  }

  public defineCollection<
    TSource extends SourceDef<TModels, 'collection'>,
    TMapped extends { id: string } = ExtractSourceResult<TSource> & { id: string },
  >(source: TSource, options?: CollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels>): Collection<TMapped> {
    return createCollection<TOps, TSource, TMapped, TModels>(
      source,
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );
  }

  public defineCollectionSync<
    TSource extends SourceDef<TModels, 'collection'>,
    TMapped extends { id: string } = ExtractSourceResult<TSource> & { id: string },
  >(
    source: TSource,
    options?: CollectionSyncOptions<ExtractSourceResult<TSource>, TMapped, TModels>,
  ): CollectionSync<TMapped> {
    return createCollectionSync<TOps, TSource, TMapped, TModels>(
      source,
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );
  }

  public defineLazyCollection<
    TSource extends SourceDef<TModels, 'collection'>,
    TMapped extends { id: string } = ExtractSourceResult<TSource> & { id: string },
  >(
    source: TSource,
    options?: LazyCollectionOptions<ExtractSourceResult<TSource>, TMapped, TModels>,
  ): LazyCollection<TMapped> {
    return createLazyCollection<TOps, TSource, TMapped, TModels>(
      source,
      options,
      this._client,
      this._watcher.updates$,
      this._resolver,
    );
  }

  public defineAssets(options?: AssetCollectionOptions | undefined): Assets {
    return createAssetsCollection(options, this._client, this._watcher.updates$);
  }

  public defineRoutes(options?: RouteCollectionOptions | undefined): Routes {
    return createRoutesCollection(options, this._client, this._watcher.updates$, this._resolver);
  }

  public defineI18nMessages(def: I18nMessageDef): I18nMessages {
    return createI18nMessagesCollection(def, this._client, this._watcher.updates$);
  }

  public ping: () => Promise<void>;
}

export function createStore<TOps extends OperationMap | undefined = undefined, TModels extends string = string>(
  options: CreateStoreOptions<TOps, TModels>,
): Store<TOps, TModels> {
  return new Store(options);
}
