---
"@contello/client": patch
---

the connection pool now routes around disconnected clients and no longer hangs on `init()` when an endpoint is unreachable.
