---
"@contello/media": major
---

replace the resolver's `image.def`/`picture.src` with a single `image.source()`, and rename `video.def`/`file.def` to `video.source`/`file.source` — the result types are now `ImageSource`, `VideoSource` and `FileSource`.
