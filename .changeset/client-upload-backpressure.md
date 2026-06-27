---
"@contello/client": patch
---

streaming uploads apply backpressure instead of buffering the whole file into the socket send queue at once.
