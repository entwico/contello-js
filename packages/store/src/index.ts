export { createStore, Store } from './store';

export { maybeThen, maybeCatch } from 'projected';
export type { MaybePromise, ReadonlyDeep } from 'projected';

export type { AssetCollectionOptions, Assets, StoreAsset, StoreFile, StoreFileMetadata } from './assets';

export type {
  I18nInitialTranslation,
  I18nMessage,
  I18nMessageDef,
  I18nMessageRegistrationDefinition,
  I18nMessages,
  I18nTranslation,
  I18nVariableInput,
} from './i18n';

export type { RouteCollectionOptions, Routes, StoreRoute, StoreRouteCustomHeader } from './routes';

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
  SyncCacheOptions,
} from './types';
