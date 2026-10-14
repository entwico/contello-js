import { AsyncLocalStorage } from 'node:async_hooks';
import { type I18nConfig, type RawTranslations, i18n } from '@astroscope/i18n';
import { getBootContext } from '@astroscope/node/boot';
import { registerHealthCheck } from '@astroscope/node/health';
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
import {
  type AnyRoutes,
  type ContelloRoutingMiddlewareOptions,
  type RoutePathResolver,
  createBoundRoutingMiddleware,
} from './routing-middleware';

const DEFAULT_IMAGES_PREFIX = '/_contello/i/';
const DEFAULT_FILES_PREFIX = '/_contello/f/';
const DEFAULT_VIDEO_PREFIX = '/_contello/v/';

export type ContelloRequestContext = {
  url: URL;
  route: ReadonlyDeep<StoreRoute> | undefined;
  rewritten: boolean;
};

/** The Contello i18n message collection bridged to `@astroscope/i18n`; `init()` takes the runtime side. */
export type ContelloI18nOptions = {
  collection: string;
  cache?: SyncCacheOptions | undefined;
};

/**
 * The `@astroscope/i18n` config `init()` passes to `i18n.configure()` before it pushes the
 * collection's translations, plus what to do with the extracted keys.
 */
export type ContelloInitI18nOptions = I18nConfig & {
  /**
   * Register the extracted keys in the collection; defaults to `true`, except in dev mode (detected via the
   * @astroscope/node boot context).
   */
  register?: boolean | undefined;
  /** push the collection's translations and follow its refreshes; defaults to `true` */
  load?: boolean | undefined;
};

export type ContelloRoutingOptions = {
  resolveRoutePath?: RoutePathResolver | undefined;
};

/** The readiness check `init()` registers with `@astroscope/node/health`; `false` registers none. */
export type ContelloHealthOptions = {
  /** @default 'contello' */
  name?: string | undefined;
  optional?: boolean | undefined;
  timeout?: number | undefined;
};

export type ContelloInitOptions = {
  load?: Loadable[] | undefined;
  /**
   * Routes backing the routing middleware: `'sync'` creates and loads a `RoutesSync` (eager, synchronous
   * lookups), `'lazy'` creates a `LazyRoutes` (fetched on demand), or an instance the project defined
   * itself, loaded by `init()` when it is loadable. Reachable as `contello.routes` after `init()`.
   * `false` for a project without Contello routes: the routing middleware passes through.
   */
  routes: 'sync' | 'lazy' | AnyRoutes | false;
  /** required when `createContello` got an `i18n` collection */
  i18n?: ContelloInitI18nOptions | undefined;
  /** defaults for the routing middleware, used by the integration-injected one */
  routing?: ContelloRoutingOptions | undefined;
  /** defaults for the assets middleware, used by the integration-injected one; `false` makes it pass through */
  assets?: ContelloAssetsMiddlewareOptions | false | undefined;
  health?: ContelloHealthOptions | false | undefined;
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

function isLoadable(value: object): value is Loadable {
  return typeof (value as Partial<Loadable>).load === 'function';
}

type HasFallback<O> = O extends { fallback: infer F } ? ([F] extends [undefined] ? false : true) : false;

export const runRequest = Symbol('@contello/astro/runRequest');

function createI18nRegistrations(): I18nMessageRegistrationDefinition[] {
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
  private _routes: AnyRoutes | undefined;
  private _initOptions: ContelloInitOptions | undefined;
  private _unregisterHealthCheck: (() => void) | undefined;

  readonly media: ContelloMediaConfig;

  // --- middleware factories (arrow fields so destructuring works) ---

  createRoutingMiddleware = (options?: ContelloRoutingMiddlewareOptions | undefined) => {
    // resolved per request: the integration creates the middleware before init() brings the routes and options
    const routes = () => options?.routes ?? (this._initOptions?.routes === false ? undefined : this.routes);
    const resolveRoutePath: RoutePathResolver = (ctx) => {
      const resolver = options?.resolveRoutePath ?? this._initOptions?.routing?.resolveRoutePath;

      return resolver ? resolver(ctx) : ctx.url.pathname;
    };

    return createBoundRoutingMiddleware(this, routes, options?.exclude, resolveRoutePath);
  };

  createAssetsMiddleware = (options?: ContelloAssetsMiddlewareOptions | undefined) => {
    return createBoundAssetsMiddleware(this, () => options ?? this._initOptions?.assets);
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

  private createRoutes(routes: ContelloInitOptions['routes']): AnyRoutes | undefined {
    switch (routes) {
      case false: {
        return undefined;
      }

      case 'sync': {
        return this.defineRoutesSync();
      }

      case 'lazy': {
        return this.defineLazyRoutes();
      }

      default: {
        return routes;
      }
    }
  }

  private registerHealthCheck(health: ContelloHealthOptions | false | undefined): void {
    if (health === false) {
      return;
    }

    this._unregisterHealthCheck?.();
    this._unregisterHealthCheck = registerHealthCheck({
      name: health?.name ?? 'contello',
      check: () => this.ping(),
      optional: health?.optional,
      timeout: health?.timeout,
    });
  }

  async init(options: ContelloInitOptions): Promise<void> {
    try {
      this._initOptions = options;

      this.registerHealthCheck(options.health);

      await this._store.init();

      this._routes = this.createRoutes(options.routes);

      if (this._options.i18n) {
        if (!options.i18n) {
          throw new Error('@contello/astro: init() needs the i18n option (locales, locale resolver) for the configured i18n collection');
        }

        const { collection, cache } = this._options.i18n;
        const dev = getBootContext()?.dev ?? false;
        const { register = !dev, load = true, ...i18nConfig } = options.i18n;

        this._i18nMessages = this._store.defineI18nMessages({ collection, cache });

        await i18n.configure(i18nConfig);

        if (register) {
          const registrations = createI18nRegistrations();

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

      const routes = this._routes;
      const loadables = [...(options.load ?? []), ...(routes && isLoadable(routes) ? [routes] : [])];

      await Promise.all(loadables.map((l) => l.load()));

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
    this._unregisterHealthCheck?.();
    this._unregisterHealthCheck = undefined;

    await this._store.destroy();

    this._i18nMessages = undefined;
    this._routes = undefined;
    this._initOptions = undefined;
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

  /** the routes backing the routing middleware, created by `init()` from its `routes` option */
  get routes(): AnyRoutes {
    if (!this._routes) {
      throw new Error('@contello/astro: .routes accessed before init() or with routes disabled');
    }

    return this._routes;
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
