import type { ContelloSdkClient } from '@contello/sdk-client';
import { type Observable, Subject, filter, map, share } from 'rxjs';

import UPDATES_SUBSCRIPTION from '../graphql/updates.gql';
import { wrap } from './diagnostics';
import type { StoreRouteFragment, StoreWatchUpdatesSubscription } from './generated/graphql';
import { type StoreRoute, mapRoute } from './routes-mapping';
import { keepalive } from './utils';

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
      case 'route':
        route.push(event);

        if ('after' in event && event.after.type === 'entity') {
          addRouteByModel(routeByEntityModel, event.after.entityType, event);
        }

        if ('before' in event && event.before.type === 'entity') {
          addRouteByModel(routeByEntityModel, event.before.entityType, event);
        }

        break;
      case 'asset':
        asset.push(event);
        break;
      case 'i18nMessage':
        i18nMessage.push(event);
        break;
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

function mapEvent(raw: RawEvent, entityTypes: ReadonlySet<string> | undefined): UpdateEvent | undefined {
  const target = raw.target;
  const id = 'id' in target ? (target.id as string) : '';
  const mutation = raw.mutation.type.toLowerCase() as UpdateMutationType;

  switch (target.__typename) {
    case 'ContelloRoute': {
      if (mutation === 'delete') {
        return { id, mutation: 'delete', target: 'route' };
      }

      const after = mapRoute(target as StoreRouteFragment);

      if (!after) {
        return undefined;
      }

      if (mutation === 'create') {
        return { id, mutation, target: 'route', after };
      }

      const before =
        raw.prev?.__typename === 'ContelloRoute' ? (mapRoute(raw.prev as StoreRouteFragment) ?? undefined) : undefined;

      if (!before) {
        return undefined;
      }

      return { id, mutation, target: 'route', after, before };
    }

    case 'ContelloAsset':
      return { id, mutation, target: 'asset' };

    case 'ContelloI18nMessage':
      return { id, mutation, target: 'i18nMessage', token: target.token };

    default:
      if (!target.__typename || (entityTypes && !entityTypes.has(target.__typename))) {
        return undefined;
      }

      return { id, mutation, target: 'entity', model: target.__typename };
  }
}

export type InternalWatcher = {
  readonly updates$: Observable<UpdateBatch>;
  start(): void;
  stop(): void;
};

export function createInternalWatcher(
  client: ContelloSdkClient<unknown>,
  entityTypes: ReadonlySet<string> | undefined,
): InternalWatcher {
  const subject = new Subject<UpdateBatch>();
  let subscription: { unsubscribe(): void } | undefined;

  const updates$ = subject.asObservable().pipe(share());

  return {
    updates$,

    start() {
      if (subscription) {
        return;
      }

      const source$ = client.subscribe<StoreWatchUpdatesSubscription>(UPDATES_SUBSCRIPTION).pipe(
        keepalive(),
        map((data) =>
          (data.contelloUpdatesBatch?.events ?? [])
            .map((e) => mapEvent(e, entityTypes))
            .filter((e): e is UpdateEvent => e !== undefined),
        ),
        filter((events) => events.length > 0),
        map(createUpdateBatch),
      );

      wrap('watcher:start', () => {
        subscription = source$.subscribe({
          next: (batch) => subject.next(batch),
          error: (err) => subject.error(err),
        });
      });
    },

    stop() {
      subscription?.unsubscribe();
      subscription = undefined;
    },
  };
}
