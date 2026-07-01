# @contello/client

## 2.2.3

### Patch Changes

- 843b64c: rebuilt under the TypeScript 6 / ESLint 10 toolchain (tsdown bundler) — internal changes only, no public API or behavior changes

## 2.2.2

### Patch Changes

- 878333d: generated documents no longer request `__typename` on flattened component references, shrinking responses (re-run codegen to pick this up).
- 878333d: flattened component responses resolve in a single pass and no longer hang on cyclic component references.
- 878333d: the connection pool now routes around disconnected clients and no longer hangs on `init()` when an endpoint is unreachable.
- 878333d: the asset and HLS proxy now validate file ids and stream paths and forward a focused set of upstream response headers.
- 878333d: streaming uploads apply backpressure instead of buffering the whole file into the socket send queue at once.
- ffc7a05: emit fragment reference lists on a single line in generated documents

## 2.2.1

### Patch Changes

- 50d01d5: resolve flat component refs and inject `__model` on every subscription

## 2.2.0

### Minor Changes

- 5d59fe1: built-in source fetchers accept filter args: `route.fetch({ ids?, paths? })`, `asset.fetch({ ids? })`, `i18nMessage.fetch({ collection, ids? })`

## 2.1.1

### Patch Changes

- properly return the whole collection from `client.sources.<X>.fetch()`, store collections, and lazy collections

## 2.1.0

### Minor Changes

- 3366494: `LocalDateTime` and `LocalDate` scalars are emitting `{ year, month, day, hour?, minute?, second? }` types

## 2.0.0

### Major Changes

- 1a787d4: `client.subscribe()` and `client.rpc.<subscription>()` now return `AsyncIterable<T>`. Iterate with `for await` or wrap with `rxjs.from(...)` if you need rxjs operators. `rxjs` is no longer a peer dependency.
- 147d2e5: codegen now emits a single `export const schema = { operations, sources, models }`

### Minor Changes

- 1a787d4: new async-iterable utils + subject
- 147d2e5: `client.sources.*` typed one-shot fetcher for every source in the schema

## 1.2.2

### Patch Changes

- 0f14d49: reference fragment types by name in generated operation/fragment types

## 1.2.1

### Patch Changes

- dfe5645: prevent errors on `ContelloComponent` recursion and unused fragments during `contello-client generate`

## 1.2.0

### Minor Changes

- dcf1311: validate user .gql documents against the schema during `contello-client generate`

### Patch Changes

- 062116a: properly resolve component refs nested inside wrapper objects

## 1.1.1

### Patch Changes

- 081881a: fix: reword "connection pool is empty" error to reference the public `client.init()` method instead of the internal `connect()`

## 1.1.0

### Minor Changes

- 7d27ca2: switch asset traffic to pooled undici HTTP/2 agent, add `proxyHls()`

### Patch Changes

- 3ac4fb8: emit `_flat_<field>` companion when a `ContelloComponent` field is populated through a fragment spread from an entity/attributes-level fragment

## 1.0.3

### Patch Changes

- d465577: check overlappings on fragment

## 1.0.2

### Patch Changes

- c3bebfc: better colored output in generator

## 1.0.1

### Patch Changes

- f0fb00d: update deps & switch to pnpm

## 1.0.0

### Major Changes

- c5d485c: init
