# @contello/store

## 4.3.0

### Minor Changes

- 6e3e942: collections, routes and assets carry the writes their schema defines — `create` / `update` / `delete`, typed from the model's own inputs

## 4.2.0

### Minor Changes

- a275603: dash utilities are no longer re-exported — import `maybeThen`, `maybeCatch`, `MaybePromise` and `ReadonlyDeep` from `@entwico/dash`

## 4.1.1

### Patch Changes

- 8be8e30: avoid redundant promise allocations when mapping collection items with synchronous mappers
- Updated dependencies [8be8e30]
  - @contello/opentelemetry@2.1.1

## 4.1.0

### Minor Changes

- lazy route lookups cache misses (404)
- cold lazy fetches (routes, collections, assets) now happen within the same tick

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @contello/opentelemetry@2.1.0

## 4.0.0

### Patch Changes

- f113e0a: replace the deprecated `projected` dependency with `@entwico/projected` and `@entwico/dash`
- Updated dependencies [f113e0a]
  - @contello/client@3.0.0

## 3.1.0

### Minor Changes

- 11dbc83: emit OpenTelemetry spans and metrics natively when `@opentelemetry/api` is installed (configured via `OTEL_CONTELLO_*` env vars); `@contello/opentelemetry` becomes the shared telemetry core and `ContelloInstrumentation` is removed

### Patch Changes

- Updated dependencies [11dbc83]
  - @contello/opentelemetry@2.0.0

## 3.0.1

### Patch Changes

- 843b64c: rebuilt under the TypeScript 6 / ESLint 10 toolchain (tsdown bundler) — internal changes only, no public API or behavior changes

## 3.0.0

### Patch Changes

- 878333d: looking up a lazily-cached route by its previous path after the route's path changed no longer returns the stale route.
- 878333d: the update watcher survives a malformed event or a throwing subscriber
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
  - @contello/media@2.0.0

## 2.1.1

### Patch Changes

- 58cfc09: accept readonly string arrays in `get()` (and routes' `getByPath()`)

## 2.1.0

### Minor Changes

- 0d1bc9f: every store kind has a default 3-hour freshness guarantee — eager stores run a periodic full refresh, lazy stores expire LRU entries on next access. `cache.ttl: 0` or `cache.ttl: false` disables
- 0d1bc9f: `I18nMessages` gains `refresh()` and `onRefresh`
- 0d1bc9f: `refresh$` streams and `onRefresh` callbacks now deliver `{ ids, kind }` (or `{ kind }` for singletons) with `kind: 'upstream-update' | 'ttl' | 'on-demand'`
- 5d59fe1: routes and assets ship as three variants each: `defineRoutes` / `defineAssets` (eager async), `defineRoutesSync` / `defineAssetsSync` (eager + sync), `defineLazyRoutes` / `defineLazyAssets` (lazy)

### Patch Changes

- 5d59fe1: i18n update events refetch only the changed ids, delete events remove entries locally without a follow-up fetch, and `refresh$` / `onRefresh` emit only the actually-changed ids. events arriving before the initial load are ignored
- 5d59fe1: shared TTL orchestrator and refresh-channel helpers extracted (`createTtlOrchestrator`, `createRefreshChannel`)
- 5d59fe1: routes, assets, and i18n stores now drive their fetches through the built-in `storeRoute` / `storeAsset` / `storeI18nMessage` sources

## 2.0.1

### Patch Changes

- properly return the whole collection from `client.sources.<X>.fetch()`, store collections, and lazy collections

## 2.0.0

### Major Changes

- 147d2e5: codegen now emits a single `export const schema = { operations, sources, models }`
- 1a787d4: `refresh$` on every definer (singleton/collection/lazy/assets/routes/i18n) and `Store.updates$` are now typed as `AsyncIterable<T>` — consume with `for await` or wrap with `rxjs.from(...)` for operators, `rxjs` and `backoff-rxjs` are no longer dependencies
- fb73267: collections can refresh incrementally instead of re-fetching the whole set on every watcher event
- fb73267: `projected` moved from a peer dep to a regular dep, and bumped to `^3.0.0`. The relevant utilities — `MaybePromise`, `maybeThen`, `maybeCatch`, `ReadonlyDeep` — are re-exported from `@contello/store`.
- fb73267: Returned values from `Collection`, `CollectionSync`, `Singleton`, `SingletonSync`, `LazyCollection`, `Assets`, `Routes`, and `I18nMessages` are typed `ReadonlyDeep<V>` (re-exported from `projected`)
- fb73267: `define{Singleton,SingletonSync,Collection,CollectionSync,LazyCollection}` now take `(source, options?)` instead of `{ model, fetch, … }`

### Minor Changes

- 147d2e5: `defineCollection` / `defineCollectionSync` / `defineLazyCollection` / `defineSingleton` / `defineSingletonSync` now accept either a string key (from `schema.sources`) or a SourceDef directly
- fb73267: `CollectionDef.sort?: (a, b) => number` — optional sorting for collection items
- 1a787d4: `Store.destroy()` now completes every internal stream so pending iterators exit cleanly and listeners detach automatically

### Patch Changes

- Updated dependencies [1a787d4]
- Updated dependencies [1a787d4]
- Updated dependencies [147d2e5]
- Updated dependencies [147d2e5]
  - @contello/client@2.0.0

## 1.5.1

### Patch Changes

- 081881a: fix: use resolved name (falls back to model) in sync singleton/collection "not initialized" error — previously showed `"undefined"` when `name` was omitted from the definition

## 1.5.0

### Minor Changes

- de8edb4: switch to defineMediaResolver

## 1.4.2

### Patch Changes

- 4926944: move `@contello/*` from `dependencies` to `peerDependencies`

## 1.4.1

### Patch Changes

- fix generics inferring

## 1.4.0

### Minor Changes

- d9daf99: integrate with `@contello/media`

### Patch Changes

- Updated dependencies [d9daf99]
  - @contello/media@1.0.0

## 1.3.0

### Minor Changes

- 7d27ca2: add `proxyHls()` to `Assets` for HLS pass-through

### Patch Changes

- Updated dependencies [3ac4fb8]
- Updated dependencies [7d27ca2]
  - @contello/client@1.1.0

## 1.2.0

### Minor Changes

- afd4330: add `refresh()` and `clear()` methods to lazy collections, routes, and assets

## 1.1.2

### Patch Changes

- f6f7ceb: update deps

## 1.1.1

### Patch Changes

- 831057c: allow async map on sync collections
- Updated dependencies [d465577]
  - @contello/client@1.0.3

## 1.1.0

### Minor Changes

- cd3c71b: add load init parameter

### Patch Changes

- 172465e: fix onLoad event emitting onRefesh
- Updated dependencies [c3bebfc]
  - @contello/client@1.0.2

## 1.0.5

### Patch Changes

- ca7c5c4: fix version

## 1.0.4

### Patch Changes

- f0fb00d: update deps & switch to pnpm
- Updated dependencies [f0fb00d]
  - @contello/client@1.0.1

## 1.0.3

### Patch Changes

- 659f8f1: fix version

## 1.0.2

### Patch Changes

- d44143f: fix workspace version

## 1.0.1

### Patch Changes

- c5d485c: use @contello/client instead of sdk-client
- c5d485c: use stricter peer deps
- Updated dependencies [c5d485c]
  - @contello/client@1.0.0

## 1.0.0

### Major Changes

- init

### Patch Changes

- Updated dependencies
  - @contello/sdk-client@8.22.0
