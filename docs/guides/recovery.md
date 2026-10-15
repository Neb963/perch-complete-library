# Export, import, migration and recovery

Portable exchange v2 includes an index with ordered part descriptors, digests, record count and omitted-corrupt list; records include their source schema/revision/digest. Verify the entire input before mutating destination keys. Plan deterministic ID remapping and update dependent conversation references. Preserve import origin metadata across subsequent ordinary edits and tombstones so replay is identifiable.

`importLocal(...,'merge',opts)` may return a **partial report** after some CAS writes due to contention/valid conflicts. Inspect remaining/conflict counts; do not claim global rollback. Exact replays should be reconciled idempotently even when earlier imports remapped source IDs. Jobs use a singleton CAS merge with collision handling and protect pending/unknown/favorites from evictions.

`migrateDomain` requires a verified backup with matching source digests, current converters and explicit owner acknowledgment. Schema cutover should be reversible through preserved backups. A recovered application must not silently resubmit uncertain native requests.

Full-size 240 MiB import-memory tests, multi-tab cross-browser tests and saved/public import behavior are **not** empirically verified in the frozen evidence. Capacity assumptions must be measured before production-scale use.
