import {
  type AsyncIterableSubject,
  type ContelloClient,
  collectAsync,
  createSourceSubscription,
  mapAsync,
  runWithBackoff,
} from '@contello/client';
import { type MaybePromise, ProjectedMap, type ReadonlyDeep, maybeThen } from 'projected';
import { wrap } from './diagnostics';
import {
  type ContelloI18nMessageInput,
  type StoreI18nMessageFragment,
  type StoreRegisterI18nMessagesMutation,
  storeRegisterI18nMessagesDocument,
  schema as storeSchema,
} from './generated/graphql';
import type { RefreshEvent, RefreshKind, SyncCacheOptions } from './types';

import {
  type RefreshByTtlQueue,
  createRefreshChannel,
  createRefresher,
  createTtlOrchestrator,
  resolveTtl,
} from './utils';
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
  const channel = createRefreshChannel<RefreshEvent>(def.onRefresh);
  const ttl = createTtlOrchestrator({ ttl: resolveTtl(def.cache?.ttl), run: () => runTtlRefresh() });
  let loaded = false;

  const i18nSourceDoc = createSourceSubscription(storeSchema.sources.storeI18nMessage);

  const projected = new ProjectedMap<string, I18nMessage>({
    key: (msg) => msg.id,
    values: (ids) =>
      wrap(`i18n:${def.collection}`, () =>
        collectAsync(
          mapAsync(
            client.subscribe<{ source: StoreI18nMessageFragment[] }>(i18nSourceDoc, {
              collection: def.collection,
              ids,
            }),
            (data) => data.source,
          ),
        ).then((msgs) => {
          const items: I18nMessage[] = msgs.map((msg) => ({
            id: msg.id,
            token: msg.token,
            translations: new Map(msg.translations.map((t) => [t.language, t.value])),
          }));

          // start tracking refresh by ttl on first successful full fetch
          if (ids === undefined && !loaded) {
            loaded = true;
            ttl.mark();
          }

          return items;
        }),
      ),
  });

  function emit(ids: string[], kind: RefreshKind): void {
    channel.emit({ ids, kind });
  }

  function emitWithCurrentIds(kind: RefreshKind): void {
    maybeThen(projected.getAll(), (msgs) => {
      emit(
        msgs.map((m) => m.id),
        kind,
      );
    });
  }

  function runTtlRefresh(): void {
    refreshByTtl.enqueue(() =>
      runWithBackoff(() => projected.refresh()).then(() => {
        emitWithCurrentIds('ttl');
        ttl.mark();
      }),
    );
  }

  const scheduleRefresh = createRefresher<RefreshKind>(
    () => projected.refresh(),
    (kind) => {
      emitWithCurrentIds(kind);
      ttl.mark();
    },
    () => {},
  );

  function runPartialRefresh(upsertedIds: string[], deletedIds: string[]): void {
    const changedIds = [...new Set([...upsertedIds, ...deletedIds])];

    if (changedIds.length === 0) {
      return;
    }

    if (upsertedIds.length === 0) {
      emit(changedIds, 'upstream-update');

      return;
    }

    void runWithBackoff(() =>
      projected.refresh(upsertedIds).then(() => {
        emit(changedIds, 'upstream-update');
      }),
    );
  }

  const unsubUpdates = updates$.subscribe((batch) => {
    if (!loaded) {
      return;
    }

    if (batch.i18nMessage.length === 0) {
      return;
    }

    const deleted: string[] = [];
    const upserted = new Set<string>();

    for (const event of batch.i18nMessage) {
      if (event.mutation === 'delete') {
        deleted.push(event.id);
      } else {
        upserted.add(event.id);
      }
    }

    if (deleted.length > 0) {
      projected.delete(deleted);
    }

    runPartialRefresh([...upserted], deleted);
  });

  return {
    refresh$: channel.stream$,

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
      ttl.clear();
      channel.complete();
    },
  };
}
