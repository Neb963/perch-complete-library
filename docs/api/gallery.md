# Gallery API

`bindGallery(backend: GalleryBackend | null)` binds a real native gallery host. The native API may synchronously return a small **placeholder `<span>`**, which later becomes an iframe. `mount(host,opts)` therefore reports a pending mount; readiness is observed separately by `GalleryHandle.observeReady(listener,deadlineMs?)`. The observer emits pending/iframe-ready/timeout states without assuming a placeholder is already an iframe.

Always dispose the returned handle when switching views; stale observer callbacks are fenced to the owning mount. Custom button payloads include optional prompt/negative-prompt/seed metadata and an explicit `sensitivity: 'flagged'|'not_flagged'|'unknown'`, never infer a safe status from missing fields. Cross-origin iframe DOM access is not guaranteed. `parseTrailingSuffixes()` and `validateGalleryOptions()` are pure helpers.

Historical live native gallery qualification is specific to frozen build `524b0c6d7a8f`; package relocation is verified offline, not re-qualified for saved/public behavior.
