# Perch Complete Library

**Reusable, typed Perchance capabilities without a mandatory application framework.**

This is the **source and documentation repository** for the Perchance library derived from frozen Stage 3 (`524b0c6d7a8f`). The library exposes stable *capability-specific* entry points for storage, text, image, native gallery, comments, chat state, host state, error outcomes, and build-time PJS/asset validation. A separate project will add a UI system later; this repository does not claim a polished UI toolkit.

> **Release status:** `v0.1.0` candidate. Frozen Stage 3 native-preview observations belong to the previous exact bundle; these relocated library bytes are verified offline but have not independently repeated all native qualifications. No npm registry publication is claimed.

## Setup and verify

```sh
npm ci
npm run verify
npm pack --dry-run
```

Requires Node >= 20 for build/tests. The runtime is generator-local ESM; there is no server, CDN dependency, dynamic plugin loader, or auto-dispatched generation during module imports.

### Install from the repository or a release artifact

Until an actual npm registry release exists, use `npm pack` to create a local tarball and install it into your application project (`npm install /path/to/perch-complete-library-0.1.0.tgz`). The package has **no runtime npm dependencies**. Use your application's build step to bundle only the needed subpaths into local Perchance `src/` assets. Node is **not required inside the generator**.

```ts
import { DraftStore, type DomainDef, type KvFolderLike } from 'perch-complete-library/storage';
import { bindText } from 'perch-complete-library/text';
import { ok, type Outcome } from 'perch-complete-library/core';
```

`DraftStore` requires explicit domain definitions and a *caller-provided* KV folder provider. `bindText` requires a *caller-provided* native backend. There is no ambient access to Perchance `root`.

## Supported imports

| Entry | Responsibility | Status |
|---|---|---|
| `perch-complete-library/core` | Outcomes, safe diagnostics, text dispatch scheduler | Supported |
| `/storage` | Typed KV records, revision/tombstones, portable exchange/recovery | Supported |
| `/text` | Text streaming, final normalization, stop/unknown outcomes | Supported |
| `/image` | Image data/tile adapter and CAS job history | Supported |
| `/gallery` | Deferred native gallery readiness and safe disposal | Supported |
| `/comments` | Native room mounting, callbacks, serialized submission | Supported |
| `/chat` | Character/conversation model and storage-backed chat service | Supported |
| `/host` | Generator identity and URL-state capability | Supported with environment restrictions |
| `/build` | PJS/HTML/manifest validation and asset assembly | Build-time entry; do not include in runtime by default |

**Not public:** reference-generator reducers, the Stage 3 browser diagnostic entry, UI primitives, upload, classification, or speculative APIs. Source presence does not imply public support.

## Documentation

- [Getting started](docs/getting-started.md) and [Public API contract](docs/public-api.md)
- [Capabilities](docs/capabilities.md), [Architecture](docs/architecture.md)
- [Native bindings](docs/guides/native-bindings.md), [Persistence](docs/guides/persistence.md), [Recovery](docs/guides/recovery.md)
- [Error semantics](docs/guides/errors.md), [Diagnostics](docs/guides/diagnostics.md)
- [Qualification](docs/qualification.md), [Limitations](docs/limitations.md), [Compatibility](docs/compatibility.md)
- [Build asset guidance](docs/guides/build-assets.md) and [Developer maintenance](docs/development.md)
- [Future UI boundary](docs/ui-extension-boundary.md)

For precise public types, inspect the generated `.d.ts` files or the source-level `src/public/*.ts` facades. Tests and examples are included with the source repository; generated `dist/` is built, not authoritative.

## Safety and operation

- **Single-key CAS only:** do not assume atomic multi-domain backups or writes.
- **`unknown` differs from failure:** do not replay uncertain native requests without reconciliation.
- **No provider calls at import:** calls are explicit through injected backends.
- **Perchance preview != saved/public:** only claim the environment actually qualified.
- **Tombstones and provenance:** do not recreate previously deleted records through ordinary create/update paths.
- **Untrusted output:** sanitize user/native strings in host DOM; never log raw prompts, secrets, or exports as diagnostics.

## License and source lineage

MIT for this library's authored implementation. See [LICENSE](LICENSE), [provenance](provenance/README.md) and [changelog](CHANGELOG.md). Third-party platform documentation from the historical archive is intentionally not republished.
