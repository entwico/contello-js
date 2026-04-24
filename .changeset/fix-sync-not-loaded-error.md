---
'@contello/store': patch
---

fix: use resolved name (falls back to model) in sync singleton/collection "not initialized" error — previously showed `"undefined"` when `name` was omitted from the definition
