---
'@contello/media': patch
---

image.url returns undefined instead of an empty string when nothing resolves; with a configured fallback its return stays a plain string
