import {
  type AsyncIterableSubject,
  type ContelloClient,
  asyncKeepalive,
  createAsyncIterableSubject,
  mapAsync,
} from '@contello/client';

import { wrap } from './diagnostics';
import {
  type ContelloMutationType,
  type StoreRouteFragment,
  type StoreWatchUpdatesSubscription,
  storeWatchUpdatesDocument,
} from './generated/graphql';
import type { ModelResolver } from './model-resolver';
import { type StoreRoute, mapRoute } from './routes-mapping';

export type UpdateEvent<TEntityType extends string = string> =
  | { id: string; mutation: 'create'; target: 'route'; after: StoreRoute }
  | { id: string; mutation: 'update'; target: 'route'; after: StoreRoute; before: StoreRoute }
  | { id: string; mutation: 'delete'; target: 'route' }
  | { id: string; mutation: 'create' | 'update' | 'delete'; target: 'asset' }
  | { id: string; mutation: 'create' | 'update' | 'delete'; target: 'i18nMessage'; token: string }
  | { id: string; mutation: 'create' | 'update' | 'delete'; target: 'entity'; model: TEntityType };

export type UpdateMutationType = UpdateEvent['mutation'];

export type UpdateEventFor<T extends UpdateEvent['target']> = Extract<UpdateEvent, { target: T }>;

export type UpdateBatch = {
  readonly events: UpdateEvent[];
  readonly route: UpdateEventFor<'route'>[];
  readonly asset: UpdateEventFor<'asset'>[];
  readonly i18nMessage: UpdateEventFor<'i18nMessage'>[];
  /** entity events grouped by model typename */
  readonly entity: Map<string, UpdateEventFor<'entity'>[]>;
  /** route events grouped by target entity model (both after and before targets for updates) */
  readonly routeByEntityModel: Map<string, UpdateEventFor<'route'>[]>;
};

function addRouteByModel(
  map: Map<string, UpdateEventFor<'route'>[]>,
  entityType: string,
  event: UpdateEventFor<'route'>,
): void {
  let list = map.get(entityType);

  if (!list) {
    list = [];
    map.set(entityType, list);
  }

  list.push(event);
}

type MutableBatch = {
  route: UpdateEventFor<'route'>[];
  asset: UpdateEventFor<'asset'>[];
  i18nMessage: UpdateEventFor<'i18nMessage'>[];
  entity: Map<string, UpdateEventFor<'entity'>[]>;
  routeByEntityModel: Map<string, UpdateEventFor<'route'>[]>;
};

function addEventToBatch(batch: MutableBatch, event: UpdateEvent): void {
  switch (event.target) {
    case 'route': {
      batch.route.push(event);

      if ('after' in event && event.after.type === 'entity') {
        addRouteByModel(batch.routeByEntityModel, event.after.model, event);
      }

      if ('before' in event && event.before.type === 'entity') {
        addRouteByModel(batch.routeByEntityModel, event.before.model, event);
      }

      break;
    }
    case 'asset': {
      batch.asset.push(event);
      break;
    }
    case 'i18nMessage': {
      batch.i18nMessage.push(event);
      break;
    }
    case 'entity': {
      let list = batch.entity.get(event.model);

      if (!list) {
        list = [];
        batch.entity.set(event.model, list);
      }

      list.push(event);
      break;
    }
  }
}

function createUpdateBatch(events: UpdateEvent[]): UpdateBatch {
  const batch: MutableBatch = {
    route: [],
    asset: [],
    i18nMessage: [],
    entity: new Map<string, UpdateEventFor<'entity'>[]>(),
    routeByEntityModel: new Map<string, UpdateEventFor<'route'>[]>(),
  };

  for (const event of events) {
    addEventToBatch(batch, event);
  }

  return {
    events,
    route: batch.route,
    asset: batch.asset,
    i18nMessage: batch.i18nMessage,
    entity: batch.entity,
    routeByEntityModel: batch.routeByEntityModel,
  };
}

type RawBatch = NonNullable<StoreWatchUpdatesSubscription['contelloUpdatesBatch']>;
type RawEvent = RawBatch['events'][number];

function castMutationType(type: ContelloMutationType): UpdateMutationType {
  switch (type) {
    case 'CREATE': {
      return 'create';
    }
    case 'UPDATE': {
      return 'update';
    }
    case 'DELETE': {
      return 'delete';
    }
  }
}

function mapEvent(raw: RawEvent, resolver: ModelResolver): UpdateEvent | undefined {
  const mutation = castMutationType(raw.mutation.type);
  const target = raw.target;
  const { id, __typename } = target;

  switch (__typename) {
    case 'ContelloRoute': {
      if (mutation === 'delete') {
        return { id, mutation: 'delete', target: 'route' };
      }

      const after = mapRoute(target as StoreRouteFragment, resolver);

      if (!after) {
        return undefined;
      }

      if (mutation === 'create') {
        return { id, mutation, target: 'route', after };
      }

      const before =
        raw.prev?.__typename === 'ContelloRoute'
          ? (mapRoute(raw.prev as StoreRouteFragment, resolver) ?? undefined)
          : undefined;

      if (!before) {
        return undefined;
      }

      return { id, mutation, target: 'route', after, before };
    }

    case 'ContelloAsset': {
      return { id, mutation, target: 'asset' };
    }

    case 'ContelloI18nMessage': {
      return { id, mutation, target: 'i18nMessage', token: target.token };
    }

    default: {
      if (!__typename || !resolver.hasTypeName(__typename)) {
        return undefined;
      }

      return { id, mutation, target: 'entity', model: resolver.resolveModel(__typename) };
    }
  }
}

function safeMapEvent(raw: RawEvent, resolver: ModelResolver): UpdateEvent | undefined {
  try {
    return mapEvent(raw, resolver);
  } catch {
    return undefined;
  }
}

export type InternalWatcher = {
  /** Multicast stream of update batches. Internal-only; the public `Store.updates$` is the AsyncIterable view. */
  readonly updates$: AsyncIterableSubject<UpdateBatch>;
  start(): void;
  stop(): void;
};

export function createInternalWatcher(client: ContelloClient<any>, resolver: ModelResolver): InternalWatcher {
  const updates$ = createAsyncIterableSubject<UpdateBatch>();
  let controller: AbortController | undefined;

  return {
    updates$,

    start() {
      if (controller) {
        return;
      }

      controller = new AbortController();
      const signal = controller.signal;

      wrap('watcher:start', () => {
        void (async () => {
          const source = asyncKeepalive(
            () => client.subscribe<StoreWatchUpdatesSubscription>(storeWatchUpdatesDocument),
            signal,
          );

          const events = mapAsync(source, (data) =>
            (data.contelloUpdatesBatch?.events ?? [])
              // a single malformed event must not throw out of the loop and kill
              // the watcher — skip it and keep consuming the stream
              .map((e) => safeMapEvent(e, resolver))
              .filter((e): e is UpdateEvent => e !== undefined),
          );

          for await (const list of events) {
            if (signal.aborted) {
              return;
            }

            if (list.length === 0) {
              continue;
            }

            try {
              updates$.next(createUpdateBatch(list));
            } catch {
              // a subscriber threw — isolate it so it can't tear down the watcher
            }
          }
        })().catch(() => {
          // asyncKeepalive only exits on abort; swallow so a terminal failure
          // never surfaces as an unhandled rejection
        });
      });
    },

    stop() {
      controller?.abort();
      controller = undefined;
      updates$.complete();
    },
  };
}
