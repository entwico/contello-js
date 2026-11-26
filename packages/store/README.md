# @contello/store

Framework-agnostic store for Contello CMS. Provides collections, lazy collections, singletons, routes, assets, i18n, and real-time updates via GraphQL subscriptions.

## Known Limitations

### Transitive dependency invalidation (lazy collections only)

Ref tracking is one-hop. If A depends on B and B depends on C, updating C invalidates B but not A. A stays cached with stale B data until its TTL expires or a direct update event for A or B arrives.

Eager collections are not affected.

**Workaround**: in `map()`, declare refs to all ancestors to flatten the chain to one hop.

### Route deletion and route-target invalidation

Deleting a route does not invalidate the entity it pointed to.

TTL or the next same-model refresh catches up after a delete.
