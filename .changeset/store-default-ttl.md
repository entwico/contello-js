---
'@contello/store': minor
---

every store kind has a default 3-hour freshness guarantee — eager stores run a periodic full refresh, lazy stores expire LRU entries on next access. `cache.ttl: 0` or `cache.ttl: false` disables
