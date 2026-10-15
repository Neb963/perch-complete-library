# Storage API

Public imports: `DraftStore`, `bindKv`, `KvFolderLike`, `DomainDef<T>`, `StoredAggregate<T>`, `ImportOrigin`, `exportLocal`, `verifyBundle`, `importLocal`, `migrateDomain`, `canonicalKey`, `canonicalJson`, `H`, `sha256HexUtf8`.

`KvFolderLike` must implement asynchronous `get`, `set`, `delete`, `keys`, and `update(key, synchronousUpdater)`. For correctness, `update` **must atomically** evaluate the updater on the latest value of **that key**. A fake/mock may emulate this but does not prove native semantics. A native transactional abort is meaningful only after qualified native testing.

```ts
const store = new DraftStore<Domains>(name => folderProvider(name), domainDefinitions);
const created = await store.commit('characters', 'alice', null, character);
const loaded = await store.load('characters', 'alice');
if (loaded.kind === 'ok' && loaded.value && !loaded.value.deleted) {
  const committed = await store.commit('characters', 'alice', loaded.value.revision, changedCharacter);
}
```

`commit(..., null, ...)` is absence-conditioned, `commit` revision-checked, and `delete` records a tombstone rather than silently recreating an ID. Use `load`/`list` to distinguish corrupt, old and too-new schemas. Domain definitions validate all typed envelopes. IDs use `^[a-z0-9_-]{1,96}$`; underlying keys are `r/<id>`.

Portable exchange v2: `exportLocal(store, domains, slug, folders, folderOf)` produces part descriptors and digests; `verifyBundle` preflights integrity; `importLocal(store,bundle,'merge',opts)` plans remapped IDs and dependency order; `migrateDomain` requires a verified backup and explicit acknowledgment. **Neither export nor import is an atomic global snapshot/transaction.** Recheck data and partial conflict reports; never promise 240 MiB memory proof without measuring it. See [Recovery](../guides/recovery.md).
