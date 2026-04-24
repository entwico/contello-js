import { AsyncLocalStorage } from 'node:async_hooks';
import { type RawTranslations, i18n } from '@astroscope/i18n';
import type { OperationMap } from '@contello/client';
import type { ImageDef, MediaResolver, MediaResolverOptions } from '@contello/media';
import {
  type AssetCollectionOptions,
  type Assets,
  type Collection,
  type CollectionDef,
  type CollectionSync,
  type CollectionSyncDef,
  type CreateStoreOptions,
  type I18nMessageRegistrationDefinition,
  type I18nMessages,
  type LazyCollection,
  type LazyCollectionDef,
  type Loadable,
  type RouteCollectionOptions,
  type Routes,
  type Singleton,
  type SingletonDef,
  type SingletonSync,
  type SingletonSyncDef,
  type Store,
  type StoreRoute,
  createStore,
} from '@contello/store';

const DEFAULT_IMAGES_PREFIX = '/_contello/i/';
const DEFAULT_FILES_PREFIX = '/_contello/f/';
const DEFAULT_VIDEO_PREFIX = '/_contello/v/';

export type ContelloRequestContext = {
  url: URL;
  route: StoreRoute | undefined;
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

export type ContelloMediaOptions = Partial<MediaResolverOptions>;

export type ContelloOptions<TOps extends OperationMap | undefined = undefined, TModels extends string = string> = Omit<
  CreateStoreOptions<TOps, TModels>,
  'media'
> & {
  assets?: AssetCollectionOptions | undefined;
  i18n?: ContelloI18nOptions | undefined;
  routes?: RouteCollectionOptions | undefined;
  media?: ContelloMediaOptions | undefined;
};

type HasMediaFallback<O> = O extends { media: { fallback: ImageDef } } ? true : false;

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

export class Contello<
  TOps extends OperationMap | undefined = undefined,
  TModels extends string = string,
  THasMediaFallback extends boolean = false,
> {
  private readonly _store: Store<TOps, TModels, true, THasMediaFallback>;
  private readonly _options: ContelloOptions<TOps, TModels>;
  private _assets: Assets | undefined;
  private _routes: Routes | undefined;
  private _i18nMessages: I18nMessages | undefined;
  private _i18nSubscription: { unsubscribe(): void } | undefined;
  private readonly _als = new AsyncLocalStorage<ContelloRequestContext>();

  constructor(options: ContelloOptions<TOps, TModels>) {
    this._options = options;

    const mediaOptions: MediaResolverOptions = {
      baseUrl: options.media?.baseUrl ?? '',
      imagesPath: options.media?.imagesPath ?? DEFAULT_IMAGES_PREFIX,
      videosPath: options.media?.videosPath ?? DEFAULT_VIDEO_PREFIX,
      filesPath: options.media?.filesPath ?? DEFAULT_FILES_PREFIX,
      ...(options.media?.fallback !== undefined ? { fallback: options.media.fallback } : {}),
      ...(options.media?.breakpoints !== undefined ? { breakpoints: options.media.breakpoints } : {}),
      ...(options.media?.pictureFormats !== undefined ? { pictureFormats: options.media.pictureFormats } : {}),
    };

    this._store = createStore({ ...options, media: mediaOptions }) as Store<TOps, TModels, true, THasMediaFallback>;
  }

  // --- lifecycle ---

  async init(options?: ContelloInitOptions | undefined): Promise<void> {
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

        this._i18nSubscription = messages.refresh$.subscribe(() => applyTranslations(messages));
      }
    }

    if (options?.load) {
      await Promise.all(options.load.map((l) => l.load()));
    }
  }

  async destroy(): Promise<void> {
    this._i18nSubscription?.unsubscribe();
    this._i18nSubscription = undefined;

    await this._store.destroy();

    this._assets = undefined;
    this._routes = undefined;
    this._i18nMessages = undefined;
  }

  ping(): Promise<void> {
    return this._store.ping();
  }

  get isReady(): boolean {
    return !!this._routes;
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

  get media(): MediaResolver<THasMediaFallback> {
    return this._store.media;
  }

  // --- ALS request context ---

  get request(): ContelloRequestContext {
    const ctx = this._als.getStore();

    if (!ctx) {
      throw new Error('@contello/astro: .request accessed outside of request context');
    }

    return ctx;
  }

  // --- store delegation ---

  defineSingleton<TModel extends TModels, TRaw, TMapped>(
    def: SingletonDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): Singleton<TMapped> {
    return this._store.defineSingleton(def);
  }

  defineSingletonSync<TModel extends TModels, TRaw, TMapped>(
    def: SingletonSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): SingletonSync<TMapped> {
    return this._store.defineSingletonSync(def);
  }

  defineCollection<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: CollectionDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): Collection<TMapped> {
    return this._store.defineCollection(def);
  }

  defineCollectionSync<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: CollectionSyncDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): CollectionSync<TMapped> {
    return this._store.defineCollectionSync(def);
  }

  defineLazyCollection<TModel extends TModels, TRaw, TMapped extends { id: string }>(
    def: LazyCollectionDef<TOps, TModel, TRaw, TMapped, TModels>,
  ): LazyCollection<TMapped> {
    return this._store.defineLazyCollection(def);
  }

  // --- ALS run ---

  [runRequest]<T>(ctx: ContelloRequestContext, fn: () => T): T {
    return this._als.run(ctx, fn);
  }
}

export function createContello<
  TOps extends OperationMap | undefined = undefined,
  TModels extends string = string,
  O extends ContelloOptions<TOps, TModels> = ContelloOptions<TOps, TModels>,
>(options: O): Contello<TOps, TModels, HasMediaFallback<O>> {
  return new Contello(options) as Contello<TOps, TModels, HasMediaFallback<O>>;
}
