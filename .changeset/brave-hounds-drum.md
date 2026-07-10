---
'@contello/client': major
---

remove the generic async-iterable utilities from the public API — import them from `@entwico/dash/async` instead (`collectAsync` → `concatAsync`, `runWithBackoff` → `retryWithBackoff`, `asyncKeepalive` → `keepalive`)
