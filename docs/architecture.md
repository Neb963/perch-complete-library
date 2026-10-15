# Architecture and invariants

## Trust and lifecycle boundaries

A Perchance `main.pjs` statically selects native plugin aliases. The embedding app supplies those aliases to typed adapter constructors. Pure/domain modules do not know the native host; state is canonical in KV. Browser views are projections, not storage truth.

1. **Native adapters:** verify selected capability exists; normalize errors/unknowns; never invent acknowledgments.
2. **Domain services:** own validation and state transitions; store using CAS and revision fencing.
3. **Application:** owns navigation, controller lifetimes, privacy policies, optional UI and native dispatch budgets.
4. **Build tooling:** validates local assets, files and profile imports. It does not select runtime plugins by introspecting `root`.

## Deterministic failure behavior

Each mutation has a unique causal operation. Stale asynchronous results are fenced by the selected record/branch/incarnation and revision. `unknown` is an observed uncertainty, not a retryable success or confirmed cancellation. PortError recoverability is explicit. UI code must avoid presenting speculative persistent state as committed.

## Storage

Only one key is atomic at a time. A multi-record import verifies first and orders dependencies, but partial writes are possible; progress/resumption and conflict outcomes are part of the interface. Crash/reload does not cause native provider work to replay implicitly. Tombstones bar ordinary recreation; deleted-character conversations retain snapshots with detached identity.

## Package compatibility

The versioned subpath facades in `src/public` are supported. Internal code can move without preserving private imports. At least one major release is needed for future incompatible schema or API changes. The eventual UI project will depend on these facades rather than becoming a dependency of core, storage or adapters.
