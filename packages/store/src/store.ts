import { type ContelloClient, type OperationMap, createContelloClient } from '@contello/client';
import { type MediaResolver, createMediaResolver } from '@contello/media';
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
  CollectionDef,
  CollectionSync,
  CollectionSyncDef,
  CreateStoreOptions,
  LazyCollection,
  LazyCollectionDef,
  Singleton,
  SingletonDef,
  SingletonSync,
  SingletonSyncDef,
} from './types';
import { type InternalWatcher, type UpdateBatch, createInternalWatcher } from './watcher';

export class Store<TOps extends OperationMap | undefined = undefined, TModels extends string = string> {
  private _client: ContelloClient<TOps>;
  private _resolver: ModelResolver;
  private _watcher: InternalWatcher;

  public readonly updates$: Observable<UpdateBatch>;
  public readonly media: MediaResolver;

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
    this.media = createMediaResolver(options.media ?? {});
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

  public defineSingleton<TModel extends TModels, TRaw, TMapped>(
    def: SingletonDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): Singleton<TMapped> {
    return createSingleton(def, this._client, this._watcher.updates$, this._resolver);
  }

  public defineSingletonSync<TModel extends TModels, TRaw, TMapped>(
    def: SingletonSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): SingletonSync<TMapped> {
    return createSingletonSync(def, this._client, this._watcher.updates$, this._resolver);
  }

  public defineCollection<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: CollectionDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): Collection<TMapped> {
    return createCollection(def, this._client, this._watcher.updates$, this._resolver);
  }

  public defineCollectionSync<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: CollectionSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): CollectionSync<TMapped> {
    return createCollectionSync(def, this._client, this._watcher.updates$, this._resolver);
  }

  public defineLazyCollection<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: LazyCollectionDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): LazyCollection<TMapped> {
    return createLazyCollection(def, this._client, this._watcher.updates$, this._resolver);
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
