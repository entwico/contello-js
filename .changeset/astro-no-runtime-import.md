---
"@contello/astro": patch
---

the package no longer imports `astro/middleware` at runtime, so modules that create the Contello instance stay out of astro's runtime module graph
