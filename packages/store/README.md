# @contello/store

Framework-agnostic store for Contello CMS. Provides collections, lazy collections, singletons, routes, assets, i18n, and real-time updates via GraphQL subscriptions.

## Known Limitations

### Transitive dependency invalidation (lazy collections only)

Ref tracking is one-hop. If A depends on B and B depends on C, updating C invalidates B but not A. A stays cached with stale B data until its TTL expires or a direct update event for A or B arrives.

Not an issue for eager collections — any same-model event triggers a full refresh.

**Workaround**: in `map()`, declare refs to all ancestors to flatten the chain to one hop.

### Route deletion and route-target invalidation

Route delete events carry only the route `id`, not the full route object. Route-target invalidation is therefore not evaluated on deletes.

TTL or the next same-model refresh catches up after a delete.

## Route tracking

Route-target invalidation is always on. When a route pointing to an entity is created, updated, or reassigned, the affected entity (and the entity that previously held the route, if any) is automatically invalidated.

Non-routable entities pay no meaningful overhead.
