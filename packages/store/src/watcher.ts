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

function createUpdateBatch(events: UpdateEvent[]): UpdateBatch {
  const route: UpdateEventFor<'route'>[] = [];
  const asset: UpdateEventFor<'asset'>[] = [];
  const i18nMessage: UpdateEventFor<'i18nMessage'>[] = [];
  const entity = new Map<string, UpdateEventFor<'entity'>[]>();
  const routeByEntityModel = new Map<string, UpdateEventFor<'route'>[]>();

  for (const event of events) {
    switch (event.target) {
      case 'route': {
        route.push(event);

        if ('after' in event && event.after.type === 'entity') {
          addRouteByModel(routeByEntityModel, event.after.model, event);
        }

        if ('before' in event && event.before.type === 'entity') {
          addRouteByModel(routeByEntityModel, event.before.model, event);
        }

        break;
      }
      case 'asset': {
        asset.push(event);
        break;
      }
      case 'i18nMessage': {
        i18nMessage.push(event);
        break;
      }
      case 'entity': {
        let list = entity.get(event.model);

        if (!list) {
          list = [];
          entity.set(event.model, list);
        }

        list.push(event);
        break;
      }
    }
  }

  return { events, route, asset, i18nMessage, entity, routeByEntityModel };
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
              .map((e) => mapEvent(e, resolver))
              .filter((e): e is UpdateEvent => e !== undefined),
          );

          for await (const list of events) {
            if (signal.aborted) {
              return;
            }

            if (list.length === 0) {
              continue;
            }

            updates$.next(createUpdateBatch(list));
          }
        })();
      });
    },

    stop() {
      controller?.abort();
      controller = undefined;
      updates$.complete();
    },
  };
}
