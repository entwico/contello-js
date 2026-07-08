---
"@contello/client": minor
"@contello/store": minor
"@contello/astro": minor
"@contello/opentelemetry": major
---

emit OpenTelemetry spans and metrics natively when `@opentelemetry/api` is installed (configured via `OTEL_CONTELLO_*` env vars); `@contello/opentelemetry` becomes the shared telemetry core and `ContelloInstrumentation` is removed
