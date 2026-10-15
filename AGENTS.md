# Repository engineering contract

This repository publishes **reusable Perchance capability libraries**, not an application, UI framework, or a generator development workflow.

1. Read README.md, docs/architecture.md, docs/public-api.md, docs/qualification.md before changes.
2. `src/public/*.ts` is the ONLY stable export boundary. Review every addition for its lifecycle, errors, dependency cost, and tests. Never add wildcard package exports.
3. Native root plugin aliases are selected statically in the generator PJS; consumers inject typed backends. Never introspect `root` or implicitly dispatch providers during import.
4. Preserve per-key CAS, tombstones, import provenance, incarnation fencing, non-replay unknown outcomes, and safe data handling. Never claim cross-key atomicity.
5. Keep UI primitives, diagnostic applications, reference-action reducers, and optional upload/classifier code internal, unless the dedicated future project qualifies them.
6. Required gate: `npm ci && npm run verify && npm pack --dry-run`. Validate clean extraction, exported entrypoints, no private imports, no secret-bearing docs, no stale release manifest.
7. Follow source-first, bounded changes and test the failure modes. If the implementation is wrong, fix tests and code; do not downgrade accepted invariants.
8. No generator Save/Publish, posting, external provider calls or release publication without separate authorization.
9. Document strict API contracts, provenance and qualification; keep limitation statements honest.
