import { AsyncLocalStorage } from 'node:async_hooks';
import { type RawTranslations, i18n } from '@astroscope/i18n';
import { getBootContext } from '@astroscope/node/boot';
import type { ContelloClient, Schema, SourceDef } from '@contello/client';
import { type MediaResolver, type MediaResolverOptions, createMediaResolver } from '@contello/media';
import {
  type Assets,
  type AssetsOptions,
  type AssetsSync,
  type AssetsSyncOptions,
  type BuiltInWrites,
  type Collection,
  type CollectionOptions,
  type CollectionSync,
  type CollectionSyncOptions,
  type CreateStoreOptions,
  type ExtractSourceResult,
  type ExtractSourceWrites,
  type I18nMessageRegistrationDefinition,
  type I18nMessages,
  type LazyAssets,
  type LazyAssetsOptions,
  type LazyCollection,
  type LazyCollectionOptions,
  type LazyRoutes,
  type LazyRoutesOptions,
  type Loadable,
  type ResolveSource,
  type Routes,
  type RoutesOptions,
  type RoutesSync,
  type RoutesSyncOptions,
  type Singleton,
  type SingletonOptions,
  type SingletonSync,
  type SingletonSyncOptions,
  type SourceKeysOf,
  type Store,
  type StoreRoute,
  type SyncCacheOptions,
  createStore,
} from '@contello/store';
import type { ReadonlyDeep } from '@entwico/dash';
import { type ContelloAssetsMiddlewareOptions, createBoundAssetsMiddleware } from './assets-middleware';
import { type ContelloRoutingMiddlewareOptions, createBoundRoutingMiddleware } from './routing-middleware';

const DEFAULT_IMAGES_PREFIX = '/_contello/i/';
const DEFAULT_FILES_PREFIX = '/_contello/f/';
const DEFAULT_VIDEO_PREFIX = '/_contello/v/';

export type ContelloRequestContext = {
  url: URL;
  route: ReadonlyDeep<StoreRoute> | undefined;
  rewritten: boolean;
};

export type ContelloI18nOptions = {
  collection: string;
  languages: string[];
  cache?: SyncCacheOptions | undefined;
};

export type ContelloInitOptions = {
  load?: Loadable[] | undefined;
  i18n?:
    | {
      /** defaults to `true`, except in dev mode (detected via the @astroscope/node boot context) */
      register?: boolean | undefined;
      load?: boolean | undefined;
    }
    | undefined;
};

export type ContelloMediaConfig = {
  readonly baseUrl: string;
  readonly imagesPath: string;
  readonly videosPath: string;
  readonly filesPath: string;
};

export type ContelloOptions<TSchema extends Schema | undefined = undefined> = CreateStoreOptions<TSchema> & {
  i18n?: ContelloI18nOptions | undefined;
  media?: Partial<ContelloMediaConfig> | undefined;
};

type HasFallback<O> = O extends { fallback: infer F } ? ([F] extends [undefined] ? false : true) : false;

export const runRequest = Symbol('@contello/astro/runRequest');

function buildI18nRegistrations(): I18nMessageRegistrationDefinition[] {
  const manifest = i18n.getManifest();
  const defaultLanguage = i18n.getConfig().defaultLocale;

  return manifest.keys.map((extracted) => ({
    token: extracted.key,
    example: extracted.meta.fallback,
    description: extracted.meta.description ?? '',
    variables: Object.entries(extracted.meta.variables ?? {}).map(([name, def]) => ({
      name,
      description: def?.description ?? '',
      example: def?.fallback ?? '',
    })),
    initialTranslations: [{ language: defaultLanguage, message: extracted.meta.fallback }],
  }));
}

async function applyTranslations(messages: I18nMessages): Promise<void> {
  const config = i18n.getConfig();
  const all = await messages.getAll();
  const byLocale = new Map<string, RawTranslations>();

  for (const locale of config.locales) {
    byLocale.set(locale, {});
  }

  for (const msg of all) {
    msg.translations.forEach((value, language) => {
      const raw = byLocale.get(language);

      if (raw) {
        raw[msg.token] = value;
      }
    });
  }

  for (const [locale, translations] of byLocale) {
    i18n.setTranslations(locale, translations);
  }
}

type ModelsOf<TSchema> = TSchema extends { models: infer M } ? keyof M & string : string;
type CollectionArg<TSchema> = SourceKeysOf<TSchema, 'entity'> | SourceDef<ModelsOf<TSchema>, 'entity'>;
type SingletonArg<TSchema> = SourceKeysOf<TSchema, 'singleton'> | SourceDef<ModelsOf<TSchema>, 'singleton'>;
type CollectionRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'entity'>>
>;
/** The write-input shape the source carries — keeps the collection's write half through the proxy. */
type CollectionWritesOf<TSchema, TArg> = ExtractSourceWrites<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'entity'>>
>;
type RouteWrites<TSchema> = BuiltInWrites<TSchema, 'route'>;
type AssetWrites<TSchema> = BuiltInWrites<TSchema, 'asset'>;
type SingletonRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'singleton'>>
>;

export class Contello<TSchema extends Schema | undefined = undefined> {
  private readonly _store: Store<TSchema>;
  private readonly _options: ContelloOptions<TSchema>;
  private _i18nMessages: I18nMessages | undefined;
  private _i18nUnsubscribe: (() => void) | undefined;
  private _initialized = false;
  private readonly _als = new AsyncLocalStorage<ContelloRequestContext>();
  private _autoLazyRoutes?: LazyRoutes;

  readonly media: ContelloMediaConfig;

  // --- middleware factories (arrow fields so destructuring works) ---

  createRoutingMiddleware = (options?: ContelloRoutingMiddlewareOptions | undefined) => {
    const routes = options?.routes ?? (this._autoLazyRoutes ??= this.defineLazyRoutes());

    return createBoundRoutingMiddleware(this, routes, options?.exclude, options?.resolveRoutePath);
  };

  createAssetsMiddleware = (options?: ContelloAssetsMiddlewareOptions | undefined) => {
    return createBoundAssetsMiddleware(this, options);
  };

  constructor(options: ContelloOptions<TSchema>) {
    this._options = options;
    this._store = createStore<TSchema>(options);

    this.media = {
      baseUrl: options.media?.baseUrl ?? '',
      imagesPath: options.media?.imagesPath ?? DEFAULT_IMAGES_PREFIX,
      videosPath: options.media?.videosPath ?? DEFAULT_VIDEO_PREFIX,
      filesPath: options.media?.filesPath ?? DEFAULT_FILES_PREFIX,
    };
  }

  // --- lifecycle ---

  async init(options?: ContelloInitOptions | undefined): Promise<void> {
    try {
      await this._store.init();

      if (this._options.i18n) {
        const { collection, languages, cache } = this._options.i18n;
        const dev = getBootContext()?.dev ?? false;
        const { register = !dev, load = true } = options?.i18n ?? {};

        this._i18nMessages = this._store.defineI18nMessages({ collection, cache });

        await i18n.configure({ locales: languages });

        if (register) {
          const registrations = buildI18nRegistrations();

          if (registrations.length > 0) {
            await this._i18nMessages.register(registrations);
          }
        }

        if (load) {
          await applyTranslations(this._i18nMessages);

          const messages = this._i18nMessages;
          const controller = new AbortController();

          this._i18nUnsubscribe = () => controller.abort();

          // background loop: re-apply translations on every refresh until destroy()
          void (async () => {
            for await (const _ of messages.refresh$) {
              if (controller.signal.aborted) {
                return;
              }

              await applyTranslations(messages);
            }
          })();
        }
      }

      await Promise.all((options?.load ?? []).map((l) => l.load()));

      this._initialized = true;
    } catch (error) {
      try {
        await this.destroy();
      } catch {
        // ignore teardown errors; the original init error is rethrown below
      }

      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._initialized = false;

    this._i18nUnsubscribe?.();
    this._i18nUnsubscribe = undefined;

    await this._store.destroy();

    this._i18nMessages = undefined;
  }

  ping(): Promise<void> {
    return this._store.ping();
  }

  get isReady(): boolean {
    return this._initialized;
  }

  get client(): ContelloClient<TSchema> {
    return this._store.client;
  }

  get i18nMessages(): I18nMessages {
    if (!this._i18nMessages) {
      throw new Error('@contello/astro: .i18nMessages accessed before init() with i18n config');
    }

    return this._i18nMessages;
  }

  // --- ALS request context ---

  get request(): ContelloRequestContext {
    const ctx = this._als.getStore();

    if (!ctx) {
      throw new Error('@contello/astro: .request accessed outside of request context');
    }

    return ctx;
  }

  // --- media resolvers (on-demand) ---

  defineMediaResolver<O extends Partial<MediaResolverOptions>>(options?: O): MediaResolver<HasFallback<O>> {
    return createMediaResolver({
      ...this.media,
      ...options,
    }) as MediaResolver<HasFallback<O>>;
  }

  // --- store delegation ---

  defineSingleton<TArg extends SingletonArg<TSchema>, TMapped = SingletonRaw<TSchema, TArg>>(
    sourceOrKey: TArg,
    options?: SingletonOptions<SingletonRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): Singleton<TMapped> {
    return this._store.defineSingleton(sourceOrKey as any, options as any) as Singleton<TMapped>;
  }

  defineSingletonSync<TArg extends SingletonArg<TSchema>, TMapped = SingletonRaw<TSchema, TArg>>(
    sourceOrKey: TArg,
    options?: SingletonSyncOptions<SingletonRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): SingletonSync<TMapped> {
    return this._store.defineSingletonSync(sourceOrKey as any, options as any) as SingletonSync<TMapped>;
  }

  defineCollection<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: CollectionOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): Collection<TMapped, CollectionWritesOf<TSchema, TArg>> {
    return this._store.defineCollection(sourceOrKey as any, options as any) as Collection<
      TMapped,
      CollectionWritesOf<TSchema, TArg>
    >;
  }

  defineCollectionSync<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: CollectionSyncOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): CollectionSync<TMapped, CollectionWritesOf<TSchema, TArg>> {
    return this._store.defineCollectionSync(sourceOrKey as any, options as any) as CollectionSync<
      TMapped,
      CollectionWritesOf<TSchema, TArg>
    >;
  }

  defineLazyCollection<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: LazyCollectionOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): LazyCollection<TMapped> {
    return this._store.defineLazyCollection(sourceOrKey as any, options as any) as LazyCollection<TMapped>;
  }

  defineRoutes(options?: RoutesOptions | undefined): Routes<RouteWrites<TSchema>> {
    return this._store.defineRoutes(options);
  }

  defineRoutesSync(options?: RoutesSyncOptions | undefined): RoutesSync<RouteWrites<TSchema>> {
    return this._store.defineRoutesSync(options);
  }

  defineLazyRoutes(options?: LazyRoutesOptions | undefined): LazyRoutes {
    return this._store.defineLazyRoutes(options);
  }

  defineAssets(options?: AssetsOptions | undefined): Assets<AssetWrites<TSchema>> {
    return this._store.defineAssets(options);
  }

  defineAssetsSync(options?: AssetsSyncOptions | undefined): AssetsSync<AssetWrites<TSchema>> {
    return this._store.defineAssetsSync(options);
  }

  defineLazyAssets(options?: LazyAssetsOptions | undefined): LazyAssets {
    return this._store.defineLazyAssets(options);
  }

  // --- ALS run ---

  [runRequest]<T>(ctx: ContelloRequestContext, fn: () => T): T {
    return this._als.run(ctx, fn);
  }
}

export function createContello<TSchema extends Schema | undefined = undefined>(
  options: ContelloOptions<TSchema>,
): Contello<TSchema> {
  return new Contello(options);
}
