import { ContelloSdkClient } from '@contello/sdk-client';
import type { Observable } from 'rxjs';

import { type AssetCollectionOptions, type Assets, createAssetsCollection } from './assets';
import { createCollection, createCollectionSync } from './collection';
import { wrap } from './diagnostics';
import { type I18nMessageDef, type I18nMessages, createI18nMessagesCollection } from './i18n';
import { createLazyCollection } from './lazy-collection';
import { createPing } from './ping';
import { type RouteCollectionOptions, type Routes, createRoutesCollection } from './routes';
import { createSingleton, createSingletonSync } from './singleton';
import type {
  ClientConfig,
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

function isClientConfig<TSdk>(client: CreateStoreOptions<TSdk, string>['client']): client is ClientConfig<TSdk> {
  return 'getSdk' in client;
}

export class Store<TSdk, TEntityTypes extends string = string> {
  private _sdkClient: ContelloSdkClient<TSdk>;
  private _url: string;
  private _entityTypes: ReadonlySet<string> | undefined;
  private _watcher: InternalWatcher;

  public readonly updates$: Observable<UpdateBatch>;

  constructor(options: CreateStoreOptions<TSdk, TEntityTypes>) {
    const { url, project, token, client: clientOption } = options;

    if (isClientConfig(clientOption)) {
      this._sdkClient = new ContelloSdkClient(clientOption.getSdk, {
        url,
        project,
        token,
        pooling: clientOption.pooling,
      });
    } else {
      this._sdkClient = clientOption;
    }

    this._url = url;
    this._entityTypes = options.entityTypes ? new Set(options.entityTypes) : undefined;
    this._watcher = createInternalWatcher(this._sdkClient, this._entityTypes);
    this.updates$ = this._watcher.updates$;
    this.ping = createPing(this._sdkClient);
  }

  private get sdk() {
    return this._sdkClient.sdk;
  }

  public async init() {
    await wrap('store:init', () => this._sdkClient.connect());

    this._watcher.start();
  }

  public async destroy() {
    this._watcher.stop();

    await wrap('store:destroy', () => this._sdkClient.disconnect());
  }

  public defineSingleton<TModel extends TEntityTypes, TRaw, TMapped>(
    def: SingletonDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): Singleton<TMapped> {
    return createSingleton(def, this.sdk, this._watcher.updates$, this._entityTypes);
  }

  public defineSingletonSync<TModel extends TEntityTypes, TRaw, TMapped>(
    def: SingletonSyncDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): SingletonSync<TMapped> {
    return createSingletonSync(def, this.sdk, this._watcher.updates$, this._entityTypes);
  }

  public defineCollection<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: CollectionDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): Collection<TMapped> {
    return createCollection(def, this.sdk, this._watcher.updates$, this._entityTypes);
  }

  public defineCollectionSync<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: CollectionSyncDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): CollectionSync<TMapped> {
    return createCollectionSync(def, this.sdk, this._watcher.updates$, this._entityTypes);
  }

  public defineLazyCollection<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: LazyCollectionDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): LazyCollection<TMapped> {
    return createLazyCollection(def, this.sdk, this._watcher.updates$, this._entityTypes);
  }

  public defineAssets(options?: AssetCollectionOptions | undefined): Assets {
    return createAssetsCollection(options, this._sdkClient, this._url, this._watcher.updates$);
  }

  public defineRoutes(options?: RouteCollectionOptions | undefined): Routes {
    return createRoutesCollection(options, this._sdkClient, this._watcher.updates$);
  }

  public defineI18nMessages(def: I18nMessageDef): I18nMessages {
    return createI18nMessagesCollection(def, this._sdkClient, this._watcher.updates$);
  }

  public ping: () => Promise<void>;
}

export function createStore<TSdk, TEntityTypes extends string = string>(
  options: CreateStoreOptions<TSdk, TEntityTypes>,
): Store<TSdk, TEntityTypes> {
  return new Store(options);
}
