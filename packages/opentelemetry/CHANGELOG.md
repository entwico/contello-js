# @contello/opentelemetry

## 2.1.0

### Minor Changes

- new `updateActiveSpan` helper to rename and enrich the currently active span

### Patch Changes

- wrapped async operations resolve without an extra promise hop

## 2.0.0

### Major Changes

- 11dbc83: emit OpenTelemetry spans and metrics natively when `@opentelemetry/api` is installed (configured via `OTEL_CONTELLO_*` env vars); `@contello/opentelemetry` becomes the shared telemetry core and `ContelloInstrumentation` is removed

## 1.0.3

### Patch Changes

- 843b64c: rebuilt under the TypeScript 6 / ESLint 10 toolchain (tsdown bundler) — internal changes only, no public API or behavior changes

## 1.0.2

### Patch Changes

- f6f7ceb: update deps

## 1.0.1

### Patch Changes

- 0c94e01: fix the startup
- c5d485c: use @contello/client instead of sdk-client

## 1.0.0

### Major Changes

- init
