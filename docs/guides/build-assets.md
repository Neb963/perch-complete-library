# Bundling and publishing assets

`perch-complete-library` is an ESM **library**. Run its build to produce declarations and ESM; bundle selected subpaths with your consuming project's standard toolchain. Package generation remains caller-owned. The library `/build` helpers accept already-bundled application source and selected native imports, then validate a small PJS/HTML/local `src/` asset set and manifest.

Avoid CDN imports, unselected `root` aliases and mismatched build IDs. The runtime file extension is `.js`; `.js.txt` may be used as transfer material where file upload restrictions require it. Keep source maps out of publicly deployed packages unless required, and ensure manifest SHA-256 digests match actual bytes. Do not confuse a successful preview with a Save/Publish operation.

The library does **not** implement a generic generator workflow, continuous deployment or UI framework. Those are separate projects.
