import { AsyncLocalStorage } from 'node:async_hooks';
import { type RawTranslations, i18n } from '@astroscope/i18n';
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

export type ContelloRequestContext = {
  url: URL;
  route: StoreRoute | undefined;
  rewritten: boolean;
};

export type ContelloI18nOptions = {
  collection: string;
  locales: string[];
  register?: boolean | undefined;
  load?: boolean | undefined;
};

export type ContelloOptions<TSdk, TEntityTypes extends string = string> = CreateStoreOptions<TSdk, TEntityTypes> & {
  assets?: AssetCollectionOptions | undefined;
  i18n?: ContelloI18nOptions | undefined;
  routes?: RouteCollectionOptions | undefined;
};

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

export class Contello<TSdk, TEntityTypes extends string = string> {
  private readonly _store: Store<TSdk, TEntityTypes>;
  private readonly _options: ContelloOptions<TSdk, TEntityTypes>;
  private _assets: Assets | undefined;
  private _routes: Routes | undefined;
  private _i18nMessages: I18nMessages | undefined;
  private _i18nSubscription: { unsubscribe(): void } | undefined;
  private readonly _als = new AsyncLocalStorage<ContelloRequestContext>();

  constructor(options: ContelloOptions<TSdk, TEntityTypes>) {
    this._options = options;
    this._store = createStore(options);
  }

  // --- lifecycle ---

  async init(): Promise<void> {
    await this._store.init();

    this._assets = this._store.defineAssets(this._options.assets);
    this._routes = this._store.defineRoutes(this._options.routes);

    if (this._options.i18n) {
      const { collection, locales, register = true, load = true } = this._options.i18n;

      this._i18nMessages = this._store.defineI18nMessages({ collection });

      await i18n.configure({ locales });

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

  // --- store delegation ---

  defineSingleton<TModel extends TEntityTypes, TRaw, TMapped>(
    def: SingletonDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): Singleton<TMapped> {
    return this._store.defineSingleton(def);
  }

  defineSingletonSync<TModel extends TEntityTypes, TRaw, TMapped>(
    def: SingletonSyncDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): SingletonSync<TMapped> {
    return this._store.defineSingletonSync(def);
  }

  defineCollection<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: CollectionDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): Collection<TMapped> {
    return this._store.defineCollection(def);
  }

  defineCollectionSync<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: CollectionSyncDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): CollectionSync<TMapped> {
    return this._store.defineCollectionSync(def);
  }

  defineLazyCollection<TModel extends TEntityTypes, TRaw, TMapped extends { id: string }>(
    def: LazyCollectionDef<TSdk, TModel, TRaw, TMapped, TEntityTypes>,
  ): LazyCollection<TMapped> {
    return this._store.defineLazyCollection(def);
  }

  // --- ALS run ---

  [runRequest]<T>(ctx: ContelloRequestContext, fn: () => T): T {
    return this._als.run(ctx, fn);
  }
}

export function createContello<TSdk, TEntityTypes extends string = string>(
  options: ContelloOptions<TSdk, TEntityTypes>,
): Contello<TSdk, TEntityTypes> {
  return new Contello(options);
}
