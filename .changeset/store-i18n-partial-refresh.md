---
'@contello/store': patch
---

i18n update events refetch only the changed ids, delete events remove entries locally without a follow-up fetch, and `refresh$` / `onRefresh` emit only the actually-changed ids. events arriving before the initial load are ignored
