# @contello/media

## 2.0.1

### Patch Changes

- a0fe2d4: accept a dynamic boolean `priority` on `<Image>` / `<Picture>` without forcing `sizes`

## 2.0.0

### Major Changes

- 878333d: the default `<source>` format is now AVIF only; add `image/webp` via `pictureFormats` to restore it.
- 878333d: replace the resolver's `image.def`/`picture.src` with a single `image.source()`, and rename `video.def`/`file.def` to `video.source`/`file.source` — the result types are now `ImageSource`, `VideoSource` and `FileSource`.
- 878333d: responsive `sizes` is now a prop on the `<Image>`/`<Picture>` components instead of a resolver option — required for `priority` images, optional otherwise (lazy images get `sizes="auto"` and fall back to `auto, 100vw`).

### Minor Changes

- 878333d: the image methods now accept bundled images (astro-style `ImageMetadata`, single or an array) as a source, not just CMS assets.
- 878333d: `file.source()` now includes the asset's `mimeType`.
- 878333d: new `<Image>` component — renders the same responsive `<picture>` markup as `<Picture>` but with a transparent wrapper, for images sitting in flex/grid layouts.
- 878333d: fallbacks can now be named (`{ id, image }`), and the resolved image is flagged with `fallback: true` when a fallback was substituted.

## 1.1.0

### Minor Changes

- ac2f0a1: resolver methods (image.def/url, picture.src, video.def/m3u8, file.def) and the `<Picture>` component now accept deeply readonly media values

## 1.0.1

### Patch Changes

- 4a872b2: fall back to the closest available variant when no image meets the requested `minWidth`/`maxWidth` (instead of returning an empty URL)

## 1.0.0

### Major Changes

- d9daf99: init
