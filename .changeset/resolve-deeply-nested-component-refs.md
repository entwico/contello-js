---
'@contello/client': patch
---

resolve component refs nested inside wrapper objects (e.g. `items[i].contentSection1`) instead of leaving them as empty `_flatId` placeholders
