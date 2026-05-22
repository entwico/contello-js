---
'@contello/client': major
---

`client.subscribe()` and `client.rpc.<subscription>()` now return `AsyncIterable<T>`. Iterate with `for await` or wrap with `rxjs.from(...)` if you need rxjs operators. `rxjs` is no longer a peer dependency.
