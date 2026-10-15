# Forensic diagnostics

Use structured codes, operation IDs, capability, phase and build/source version; never include raw prompts, chat history, full image data URLs, passwords, session identifiers, unreviewed native iframe messages or full import payloads. Bounded redaction-compatible counters, sizes and SHA-256 digests are preferable for payload correlation.

The simple `makeDiagnosticSink()` is an in-memory test convenience; the application owns retention and upload/privacy policies. Every mutation path should report whether a specific revision actually committed. Detect and fence stale callbacks, duplicate event delivery and disposal races. Native/preview evidence should include exact fixture build, observed timestamps, dispatch counts, and restoration proofs where relevant.
