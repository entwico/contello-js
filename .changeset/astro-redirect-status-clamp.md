---
"@contello/astro": patch
---

redirect routes whose configured response code is outside the valid redirect range fall back to 302 instead of throwing.
