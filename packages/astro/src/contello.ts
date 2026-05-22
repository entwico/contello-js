import { AsyncLocalStorage } from 'node:async_hooks';
import { type RawTranslations, i18n } from '@astroscope/i18n';
import type { Schema, SourceDef } from '@contello/client';
import { type ImageDef, type MediaResolver, type MediaResolverOptions, createMediaResolver } from '@contello/media';
import {
  type AssetCollectionOptions,
  type Assets,
  type Collection,
  type CollectionOptions,
  type CollectionSync,
  type CollectionSyncOptions,
  type CreateStoreOptions,
  type ExtractSourceResult,
  type I18nMessageRegistrationDefinition,
  type I18nMessages,
  type LazyCollection,
  type LazyCollectionOptions,
  type Loadable,
  type ReadonlyDeep,
  type ResolveSource,
  type RouteCollectionOptions,
  type Routes,
  type Singleton,
  type SingletonOptions,
  type SingletonSync,
  type SingletonSyncOptions,
  type SourceKeysOf,
  type Store,
  type StoreRoute,
  createStore,
} from '@contello/store';

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
};

export type ContelloInitOptions = {
  load?: Loadable[] | undefined;
  i18n?:
    | {
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
  assets?: AssetCollectionOptions | undefined;
  i18n?: ContelloI18nOptions | undefined;
  routes?: RouteCollectionOptions | undefined;
  media?: Partial<ContelloMediaConfig> | undefined;
};

type HasFallback<O> = O extends { fallback: ImageDef } ? true : false;

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

  for (const [locale, translations] of byLocale.entries()) {
    i18n.setTranslations(locale, translations);
  }
}

type ModelsOf<TSchema> = TSchema extends { models: infer M } ? keyof M & string : string;
type CollectionArg<TSchema> = SourceKeysOf<TSchema, 'entity'> | SourceDef<ModelsOf<TSchema>, 'entity'>;
type SingletonArg<TSchema> = SourceKeysOf<TSchema, 'singleton'> | SourceDef<ModelsOf<TSchema>, 'singleton'>;
type CollectionRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'entity'>>
>;
type SingletonRaw<TSchema, TArg> = ExtractSourceResult<
  Extract<ResolveSource<TSchema, TArg>, SourceDef<string, 'singleton'>>
>;

export class Contello<TSchema extends Schema | undefined = undefined> {
  private readonly _store: Store<TSchema>;
  private readonly _options: ContelloOptions<TSchema>;
  private _assets: Assets | undefined;
  private _routes: Routes | undefined;
  private _i18nMessages: I18nMessages | undefined;
  private _i18nUnsubscribe: (() => void) | undefined;
  private _initialized = false;
  private readonly _als = new AsyncLocalStorage<ContelloRequestContext>();

  readonly media: ContelloMediaConfig;

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

      this._assets = this._store.defineAssets(this._options.assets);
      this._routes = this._store.defineRoutes(this._options.routes);

      if (this._options.i18n) {
        const { collection, languages } = this._options.i18n;
        const { register = true, load = true } = options?.i18n ?? {};

        this._i18nMessages = this._store.defineI18nMessages({ collection });

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

      if (options?.load) {
        await Promise.all(options.load.map((l) => l.load()));
      }

      this._initialized = true;
    } catch (err) {
      await this.destroy().catch(() => {});

      throw err;
    }
  }

  async destroy(): Promise<void> {
    this._initialized = false;

    this._i18nUnsubscribe?.();
    this._i18nUnsubscribe = undefined;

    await this._store.destroy();

    this._assets = undefined;
    this._routes = undefined;
    this._i18nMessages = undefined;
  }

  ping(): Promise<void> {
    return this._store.ping();
  }

  get isReady(): boolean {
    return this._initialized;
  }

  // --- pre-wired collections ---

  get assets(): Assets {
    if (!this._assets) {
      throw new Error('@contello/astro: .assets accessed before init()');
    }

    return this._assets;
  }

  get routes(): Routes {
    if (!this._routes) {
      throw new Error('@contello/astro: .routes accessed before init()');
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
  ): Collection<TMapped> {
    return this._store.defineCollection(sourceOrKey as any, options as any) as Collection<TMapped>;
  }

  defineCollectionSync<
    TArg extends CollectionArg<TSchema>,
    TMapped extends { id: string } = CollectionRaw<TSchema, TArg> & { id: string },
  >(
    sourceOrKey: TArg,
    options?: CollectionSyncOptions<CollectionRaw<TSchema, TArg>, TMapped, ModelsOf<TSchema>>,
  ): CollectionSync<TMapped> {
    return this._store.defineCollectionSync(sourceOrKey as any, options as any) as CollectionSync<TMapped>;
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
