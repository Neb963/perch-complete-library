# Typed errors and uncertain results

`Outcome<T>` has exactly four top-level states:

- `ok`: the specific API operation completed with the reported value.
- `error`: an actual typed local/native error occurred; inspect `PortError.code` and `recoverability`.
- `unknown`: native outcome could not be determined. **Do not automatically replay** mutating provider operations.
- `unavailable`: required native capability is missing or not qualified in this environment.

Treat UI optimistic state as provisional until KV commit. Do not transform unobserved delivery/transport into successful posting. Error messages are safe summaries, not raw native data dumps. Where the result is partial (import, cleanup), retain causal IDs and let the operator reconcile before retries.
