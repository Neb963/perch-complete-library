# Future UI extension boundary

UI productization is deliberately **not** in this release. The next project can introduce `src/ui` or a new `perch-complete-library/ui` subpath by separately designing semantic controls, themes, accessibility tests and reusable view projections. Historical Stage 3 UI code remains under `tests/legacy/ui/` only as regression material; it is not a stable contract.

Rules for later UI: depend on public `core`/`storage`/`chat`/native adapter types, never import private storage envelopes or access `root` directly; maintain canonical persistent state outside view components; fence stale callbacks/abort actions; avoid a mandatory global theme or application shell. Prefer additive exports over breaking old consumers.
