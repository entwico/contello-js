---
"@contello/media": major
---

responsive `sizes` is now a prop on the `<Image>`/`<Picture>` components instead of a resolver option — required for `priority` images, optional otherwise (lazy images get `sizes="auto"` and fall back to `auto, 100vw`).
