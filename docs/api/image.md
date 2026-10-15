# Image API

`bindImage(backend: NativeImageBackend | null)` validates native capability injection and returns explicit data and native-tile operations. `validateImageOptions` checks options before provider invocation. Data mode is awaited and returns `GeneratedImageData` (data URL, canvas and sanitized inputs); tile mode returns a native host and observation/disposal controls and must **not be awaited as an image promise**.

`JobStore(folder: KvFolderLike, sessionId)` persists a single `local-history` collection with per-key CAS; `reserve(prompt, mode, params)` returns a job ID before generation, and `complete(jobId, resultKind, remoteUrl?)` records the result afterward. `pending`, `unknown`, `failed`, and `available` are distinct. Eviction must never silently discard a pending, unknown or favorite record. Local data URLs are **not** remote URLs; avoid persisting large image bytes in the small history record.

The caller controls generation budgets, job cancellation policy, object-URL lifetime and render host disposal. See [Gallery](gallery.md) for native gallery behavior.
