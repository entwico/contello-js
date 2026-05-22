---
'@contello/store': major
---

`refresh$` on every definer (singleton/collection/lazy/assets/routes/i18n) and `Store.updates$` are now typed as `AsyncIterable<T>` — consume with `for await` or wrap with `rxjs.from(...)` for operators, `rxjs` and `backoff-rxjs` are no longer dependencies
