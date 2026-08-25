---
'@contello/client': minor
---

`client.sources.<model>` exposes `create` / `update` / `delete` for the mutations the schema defines for that model. A `create`/`update` selects the source's own fragment, so it answers with the entity in the same shape `fetch` yields; a `delete` answers with the id it removed
