# @contello/astro

## 4.0.0

### Major Changes

- f693ef3: `@astroscope/node` replaces `@astroscope/excludes` as a peer dependency

### Minor Changes

- f693ef3: skip i18n token registration automatically in dev mode

## 3.2.0

### Minor Changes

- 11dbc83: emit OpenTelemetry spans and metrics natively when `@opentelemetry/api` is installed (configured via `OTEL_CONTELLO_*` env vars); `@contello/opentelemetry` becomes the shared telemetry core and `ContelloInstrumentation` is removed

### Patch Changes

- Updated dependencies [11dbc83]
  - @contello/opentelemetry@2.0.0

## 3.1.0

### Minor Changes

- c0e96b2: support Astro 7 (still works with Astro 6)

## 3.0.0

### Major Changes

- 878333d: the media resolver exposed via `defineMediaResolver()` follows `@contello/media`'s new source-based API — use `image.source()`, `video.source()` and `file.source()` instead of the old `image.def`/`picture.src`/`video.def`/`file.def` methods.

### Patch Changes

- 878333d: asset routes now honor the configured mime type and content disposition, so attachment routes download instead of rendering inline.
- 878333d: redirect routes whose configured response code is outside the valid redirect range fall back to 302 instead of throwing.
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
- Updated dependencies [878333d]
  - @contello/media@2.0.0
  - @contello/store@3.0.0

## 2.2.1

### Patch Changes

- e9a4a93: routing middleware uses routes lazily by default

## 2.2.0

### Minor Changes

- fd6c1bf: routing middleware accepts a `resolveRoutePath` callback to derive the lookup path from the request

## 2.1.0

### Minor Changes

- 0d1bc9f: `ContelloI18nOptions` accepts a `cache` field, forwarded to the i18n messages store
- 5d59fe1: middleware factories live on the contello instance: `contello.createRoutingMiddleware()` and `contello.createAssetsMiddleware()`

## 2.0.0

### Major Changes

- fb73267: `ContelloRequestContext.route` is typed `ReadonlyDeep<StoreRoute>` (follows the underlying store change).
- 147d2e5: codegen now emits a single `export const schema = { operations, sources, models }`

### Minor Changes

- 147d2e5: `defineCollection` / `defineCollectionSync` / `defineLazyCollection` / `defineSingleton` / `defineSingletonSync` now accept either a string key (from `schema.sources`) or a SourceDef directly

### Patch Changes

- Updated dependencies [1a787d4]
- Updated dependencies [1a787d4]
- Updated dependencies [147d2e5]
- Updated dependencies [147d2e5]
- Updated dependencies [147d2e5]
- Updated dependencies [fb73267]
- Updated dependencies [1a787d4]
- Updated dependencies [1a787d4]
- Updated dependencies [fb73267]
- Updated dependencies [fb73267]
- Updated dependencies [fb73267]
- Updated dependencies [fb73267]
  - @contello/client@2.0.0
  - @contello/store@2.0.0

## 1.4.2

### Patch Changes

- 0f45854: restore `.assets` / `.routes` / `.i18nMessages` access from inside loadable `map` functions

## 1.4.1

### Patch Changes

- 35c4e21: properly recover from failed re-initializations

## 1.4.0

### Minor Changes

- de8edb4: switch to defineMediaResolver

## 1.3.1

### Patch Changes

- 4926944: move `@contello/*` from `dependencies` to `peerDependencies`
- Updated dependencies [4926944]
  - @contello/store@1.4.2

## 1.3.0

### Minor Changes

- d9daf99: integrate with `contello.media`

### Patch Changes

- Updated dependencies [d9daf99]
- Updated dependencies [d9daf99]
  - @contello/media@1.0.0
  - @contello/store@1.4.0

## 1.2.0

### Minor Changes

- 7d27ca2: add `createAssetsMiddleware` for proxying Contello asset files

### Patch Changes

- 3ac4fb8: update deps
- Updated dependencies [3ac4fb8]
- Updated dependencies [7d27ca2]
- Updated dependencies [7d27ca2]
  - @contello/client@1.1.0
  - @contello/store@1.3.0

## 1.1.3

### Patch Changes

- f6f7ceb: update deps
- f6f7ceb: change the throw to the log message on missing contello configuration
- 8845af1: move i18n loading / registering to the init options
- Updated dependencies [f6f7ceb]
  - @contello/store@1.1.2

## 1.1.2

### Patch Changes

- b705cfd: remove externalization

## 1.1.1

### Patch Changes

- d465577: externalize from astro build
- Updated dependencies [d465577]
- Updated dependencies [831057c]
  - @contello/client@1.0.3
  - @contello/store@1.1.1

## 1.1.0

### Minor Changes

- cd3c71b: add load init parameter

### Patch Changes

- 172465e: locales => languages
- Updated dependencies [c3bebfc]
- Updated dependencies [172465e]
- Updated dependencies [cd3c71b]
  - @contello/client@1.0.2
  - @contello/store@1.1.0

## 1.0.5

### Patch Changes

- ca7c5c4: fix version
- Updated dependencies [ca7c5c4]
  - @contello/store@1.0.5

## 1.0.4

### Patch Changes

- f0fb00d: update deps & switch to pnpm
- Updated dependencies [f0fb00d]
  - @contello/client@1.0.1
  - @contello/store@1.0.4

## 1.0.3

### Patch Changes

- 659f8f1: fix version
- Updated dependencies [659f8f1]
  - @contello/store@1.0.3

## 1.0.2

### Patch Changes

- d44143f: fix workspace version
- Updated dependencies [d44143f]
  - @contello/store@1.0.2

## 1.0.1

### Patch Changes

- c5d485c: use @contello/client instead of sdk-client
- c5d485c: use stricter peer deps
- Updated dependencies [c5d485c]
- Updated dependencies [c5d485c]
- Updated dependencies [c5d485c]
  - @contello/client@1.0.0
  - @contello/store@1.0.1

## 1.0.0

### Major Changes

- init

### Patch Changes

- Updated dependencies
  - @contello/store@1.0.0
