---
'@contello/store': minor
---

`Store.destroy()` now completes every internal stream so pending iterators exit cleanly and listeners detach automatically
