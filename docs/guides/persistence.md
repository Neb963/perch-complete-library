# Persistence and concurrency

KV is canonical storage; browser component state is transient projection. Each defined domain owns validation, schema major and folder name. Create and update operations must use **synchronous** native KV update callbacks; awaiting inside the updater invalidates atomicity. Use read → expected revision → CAS commit and handle `REVISION_CONFLICT`. There is no global multi-record transaction.

Tombstones preserve identity barriers. The same ID cannot be recreated using ordinary writes; a replacement object needs a new incarnation and explicit binding. On schema-major mismatch, distinguish legacy migration requirement from future-schema incompatibility and corruption. `ListReport` includes degraded scans/issue counts rather than falsely returning complete records.

A deadline or stop request does not confirm that remote generation was canceled. Preserve pending/unknown states across reload and reconcile before retry. Operation IDs identify causality, and late completions may commit only if their origin/session/branch revision is still current.
