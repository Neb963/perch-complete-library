# Capability map

| Module | API guide | Dependency model |
|---|---|---|
| core | [Core](api/core.md) | Pure ESM, no Perchance import |
| storage | [Storage](api/storage.md) | Caller-owned `KvFolderLike`; global WebCrypto for digests |
| text | [Text](api/text.md) | Injected `NativeBackend` |
| image | [Image](api/image.md) | Injected `NativeImageBackend`; optional persisted `JobStore` |
| gallery | [Gallery](api/gallery.md) | Injected gallery backend + DOM host |
| comments | [Comments](api/comments.md) | Native room factory + DOM host |
| chat | [Chat](api/chat.md) | DraftStore and text dispatch scheduler |
| host | [Host](api/host.md) | Explicit snapshot of generator environment |
| build | [Build](api/build.md) | Build-time caller-owned assets |

Optional upload/classification code is retained as internal, **not a qualified stable public capability**. Future UI is a separate project. No module imports plugins from `root` at load time. All I/O must be triggered by explicit consumer calls.
