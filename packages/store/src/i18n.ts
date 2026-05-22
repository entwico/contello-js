import {
  type AsyncIterableSubject,
  type ContelloClient,
  collectAsync,
  createAsyncIterableSubject,
  mapAsync,
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

import { createRefresher } from './utils';
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
};

export type I18nMessage = {
  id: string;
  token: string;
  translations: Map<string, string>;
};

export type I18nMessages = {
  readonly refresh$: AsyncIterable<string[]>;
  get(id: string): MaybePromise<ReadonlyDeep<I18nMessage> | undefined>;
  get(ids: string[]): MaybePromise<ReadonlyDeep<I18nMessage[]>>;
  getAll(): MaybePromise<ReadonlyDeep<I18nMessage[]>>;
  register(messages: I18nMessageRegistrationDefinition[]): Promise<void>;
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
): I18nMessages {
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
        ).then((msgs) =>
          msgs.map((msg) => ({
            id: msg.id,
            token: msg.token,
            translations: new Map(msg.translations.map((t) => [t.language, t.value])),
          })),
        ),
      ),
  });

  const refresh$ = createAsyncIterableSubject<string[]>();

  const scheduleRefresh = createRefresher(
    () => projected.refresh(),
    () => {
      maybeThen(projected.getAll(), (msgs) => {
        refresh$.next(msgs.map((m) => m.id));
      });
    },
    () => {},
  );

  const unsubUpdates = updates$.subscribe((batch) => {
    if (batch.i18nMessage.length > 0) {
      scheduleRefresh();
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

    destroy() {
      unsubUpdates();
      refresh$.complete();
    },
  };
}
