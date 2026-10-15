# Compatibility

- Node >=20 is required for library build/test/release tooling. Browser runtime targets modern ES2022 and WebCrypto/structuredClone-capable environments; this must be requalified on older browsers rather than silently polyfilled.
- The package publishes ESM and `.d.ts` declarations. CommonJS `require()` is not exported in v0.1.0.
- Static plugin aliases must match the actual Perchance native plugin version and selection. Saved/public serving is not qualified by editor-preview-only evidence.
- API entrypoints are explicit. `src` paths, the package root, optional upload/classifier implementations, UI primitives and old diagnostic app APIs are deliberately private.
- 0.1.x patches must preserve storage schema and public behavior; breaking pre-1.0 APIs require a release note and an explicit migration path.
