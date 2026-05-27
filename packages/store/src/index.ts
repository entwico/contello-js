export { createStore, Store } from './store';

export { maybeThen, maybeCatch } from 'projected';
export type { MaybePromise, ReadonlyDeep } from 'projected';

export type { Assets, AssetsOptions, AssetsSync, AssetsSyncOptions } from './assets';
export type { LazyAssets, LazyAssetsOptions, StoreAsset, StoreFile, StoreFileMetadata } from './lazy-assets';

export type {
  I18nInitialTranslation,
  I18nMessage,
  I18nMessageDef,
  I18nMessageRegistrationDefinition,
  I18nMessages,
  I18nTranslation,
  I18nVariableInput,
} from './i18n';

export type { Routes, RoutesOptions, RoutesSync, RoutesSyncOptions } from './routes';
export type { LazyRoutes, LazyRoutesOptions, StoreRoute, StoreRouteCustomHeader } from './lazy-routes';

export type { MapperContext } from './dependency-collector';

export type { UpdateBatch, UpdateEvent, UpdateEventFor, UpdateMutationType } from './watcher';

export type {
  CacheOptions,
  Collection,
  CollectionOptions,
  CollectionSync,
  CollectionSyncOptions,
  CreateStoreOptions,
  ExtractSourceResult,
  LazyCacheOptions,
  Loadable,
  LazyCollection,
  LazyCollectionOptions,
  Singleton,
  SingletonOptions,
  SingletonSync,
  SingletonSyncOptions,
  ResolveSource,
  SourceAt,
  SourceKeysOf,
  SyncCacheOptions,
} from './types';
