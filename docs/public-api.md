# Stable public API and versioning

The only supported import paths are:

```text
perch-complete-library/core
perch-complete-library/storage
perch-complete-library/text
perch-complete-library/image
perch-complete-library/gallery
perch-complete-library/comments
perch-complete-library/chat
perch-complete-library/host
perch-complete-library/build
```

The root package import is intentionally **not exported**. No wildcard or direct `src/`/`dist/` paths are part of the contract. Node's `exports` map enforces this at runtime; generated declarations enforce types. No `ui`, `files`, `safety` or test-fake subpath exists in 0.1.0.

All API entrypoints are explicit selective export facades in `src/public`; no duplicate application implementation is maintained. `Outcome<T>` is a discriminated union `ok | error | unknown | unavailable`, never a boolean shortcut. Historical source names are not themselves public contracts.

**SemVer policy:** Before 1.0.0, minor versions may introduce deliberate API changes with migration notes; patch releases cannot change persisted schema silently. After 1.0.0, breaking public API or format changes require a major release. Library versioning is independent of historical design version v0.3.6.

Inspect [API pages](capabilities.md) for operation-specific details and [limitations](limitations.md) for operational holds.
