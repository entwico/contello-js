import {
  type AsyncIterableSubject,
  type ContelloClient,
  collectAsync,
  createAsyncIterableSubject,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep, maybeThen } from 'projected';
import { wrap } from './diagnostics';
import {
  type ContelloI18nMessageInput,
  type StoreGetI18nMessagesSubscription,
  type StoreRegisterI18nMessagesMutation,
  storeGetI18nMessagesDocument,
  storeRegisterI18nMessagesDocument,
} from './generated/graphql';
import type { RefreshEvent, RefreshKind, SyncCacheOptions } from './types';

import { type RefreshByTtlQueue, createRefresher, resolveTtl } from './utils';
import type { UpdateBatch } from './watcher';

export type I18nTranslation = {
  language: string;
  value: string;
};

export type I18nVariableInput = {
  name: string;
  description: string;
  example: string;
};

export type I18nInitialTranslation = {
  language: string;
  message: string;
};

export type I18nMessageRegistrationDefinition = {
  token: string;
  example?: string | undefined;
  description?: string | undefined;
  variables?: I18nVariableInput[] | undefined;
  /** always overwrites existing translations for this token */
  translations?: I18nInitialTranslation[] | undefined;
  /** only applied when the token is newly registered (existing translations are preserved) */
  initialTranslations?: I18nInitialTranslation[] | undefined;
};

export type I18nMessageDef = {
  collection: string;
  cache?: SyncCacheOptions | undefined;
  onRefresh?: ((event: RefreshEvent) => void) | undefined;
};

export type I18nMessage = {
  id: string;
  token: string;
  translations: Map<string, string>;
};

export type I18nMessages = {
  readonly refresh$: AsyncIterable<RefreshEvent>;
  get(id: string): MaybePromise<ReadonlyDeep<I18nMessage> | undefined>;
  get(ids: string[]): MaybePromise<ReadonlyDeep<I18nMessage[]>>;
  getAll(): MaybePromise<ReadonlyDeep<I18nMessage[]>>;
  register(messages: I18nMessageRegistrationDefinition[]): Promise<void>;
  refresh(): void;
  /** Completes refresh$ and detaches from the watcher — called by `Store.destroy()`. */
  destroy(): void;
};

function toGqlMessageInput(msg: I18nMessageRegistrationDefinition): ContelloI18nMessageInput {
  return {
    token: msg.token,
    example: msg.example,
    description: msg.description,
    variables: msg.variables?.map((v) => ({ name: v.name, description: v.description, example: v.example })),
    translations: msg.translations?.map((t) => ({ language: t.language, message: t.message })),
    initialTranslations: msg.initialTranslations?.map((t) => ({ language: t.language, message: t.message })),
  };
}

export function createI18nMessagesCollection(
  def: I18nMessageDef,
  client: ContelloClient<any>,
  updates$: AsyncIterableSubject<UpdateBatch>,
  refreshByTtl: RefreshByTtlQueue,
): I18nMessages {
  const ttl = resolveTtl(def.cache?.ttl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loaded = false;

  const projected = new ProjectedMap<string, I18nMessage>({
    key: (msg) => msg.id,
    values: () =>
      wrap(`i18n:${def.collection}`, () =>
        collectAsync(
          mapAsync(
            client.subscribe<StoreGetI18nMessagesSubscription>(storeGetI18nMessagesDocument, {
              collection: def.collection,
            }),
            (data) => data.contelloI18nMessagesBatch,
          ),
        ).then((msgs) => {
          const items = msgs.map((msg) => ({
            id: msg.id,
            token: msg.token,
            translations: new Map(msg.translations.map((t) => [t.language, t.value])),
          }));

          // start tracking refresh by ttl on first successful full fetch
          if (!loaded) {
            loaded = true;
            scheduleTtl();
          }

          return items;
        }),
      ),
  });

  const refresh$ = createAsyncIterableSubject<RefreshEvent>();

  function emit(ids: string[], kind: RefreshKind): void {
    const event: RefreshEvent = { ids, kind };

    refresh$.next(event);
    def.onRefresh?.(event);
  }

  function emitWithCurrentIds(kind: RefreshKind): void {
    maybeThen(projected.getAll(), (msgs) => {
      emit(
        msgs.map((m) => m.id),
        kind,
      );
    });
  }

  function scheduleTtl(): void {
    clearTimeout(timer);

    if (ttl === undefined) {
      return;
    }

    timer = setTimeout(runTtlRefresh, ttl);
  }

  function runTtlRefresh(): void {
    refreshByTtl.enqueue(() =>
      runWithBackoff(() => projected.refresh()).then(() => {
        emitWithCurrentIds('ttl');
        scheduleTtl();
      }),
    );
  }

  const scheduleRefresh = createRefresher<RefreshKind>(
    () => projected.refresh(),
    (kind) => {
      emitWithCurrentIds(kind);
      scheduleTtl();
    },
    () => {},
  );

  const unsubUpdates = updates$.subscribe((batch) => {
    if (batch.i18nMessage.length > 0) {
      scheduleRefresh('upstream-update');
    }
  });

  return {
    refresh$,

    get(idOrIds: string | string[]): any {
      return projected.get(idOrIds as string);
    },

    getAll() {
      return projected.getAll();
    },

    register(messages: I18nMessageRegistrationDefinition[]) {
      return wrap(`i18n-register:${def.collection}`, () =>
        client
          .execute<StoreRegisterI18nMessagesMutation>(storeRegisterI18nMessagesDocument, {
            collection: def.collection,
            messages: messages.map(toGqlMessageInput),
          })
          .then(() => {}),
      );
    },

    refresh() {
      scheduleRefresh('on-demand');
    },

    destroy() {
      unsubUpdates();
      clearTimeout(timer);
      refresh$.complete();
    },
  };
}
