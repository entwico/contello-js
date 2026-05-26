---
'@contello/store': minor
---

`refresh$` streams and `onRefresh` callbacks now deliver `{ ids, kind }` (or `{ kind }` for singletons) with `kind: 'upstream-update' | 'ttl' | 'on-demand'`
