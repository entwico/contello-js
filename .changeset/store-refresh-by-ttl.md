---
'@contello/store': minor
---

every store kind now has a default 3-hour freshness guarantee — collections and singletons run a periodic full refresh, lazy collections/routes/assets expire LRU entries on next access. set `cache.ttl: 0` or `cache.ttl: false` to disable
