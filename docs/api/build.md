# Build / static package API

`composeImports(selectedProfiles)` creates deterministic, audited native aliases; `lintPjs`, `lintHtml`, `lintManifest` catch malformed references and forbidden source patterns. `composePackage({buildId,previousBuildId,generatorSlug,selectedProfiles})` produces the native import source and declared bindings. `buildSentinelHtml`, `buildIndexHtml` construct a local-asset-only bootstrap.

`assemble({generatorSlug,buildId,previousBuildId,selectedProfiles,scriptBody,styleBody})` builds `main.pjs`, an HTML fragment, file-content mapping and manifest for **already-bundled application JS/CSS**. `validateAssembled` checks structural consistency and fingerprints. It does not resolve module imports, generate application controllers, or save/publish a generator. Runtime JS transfer copies may use `.js.txt` in archives; runtime references remain `.js`.

Build tools are separated into `/build` so application runtime consumers need not import PJS/asset validation logic. See [Build assets](../guides/build-assets.md).
