# Developer guide and release hygiene

1. `npm ci` on a supported Node >=20 toolchain; no runtime dependencies.
2. `npm run verify` must pass strict compile, stable library build, all 25 inherited tests, public export/import checks, private-path fence, package manifest and documentation links.
3. `npm pack --dry-run --json` must contain only approved ESM `.js`, `.d.ts`, package metadata, changelog, README and LICENSE. Never publish raw frozen archives or original diagnostic evidence logs.
4. Change domain behavior with regression tests for CAS conflict, stale completion, import integrity and partial recovery; preserve historical evidence independently.
5. Every new public symbol requires an explicit `src/public` export, a typed signature, documented error/cancellation semantics, and a consumer regression test.
6. Historical UI, diagnostic browser, reference reducers and composition fixtures live in `tests/legacy/`. Keep `src/files` and `src/safety` internal. No new public module until requirements and native qualification justify it.
7. Release tags/assets must correspond to a clean commit; record checksums and parity. Do not tag or publish until GitHub CI and clean clone are proven green.

A `v0.1.0` tag is appropriate only after verified commit and CI; do not infer such a tag from `package.json` alone.
