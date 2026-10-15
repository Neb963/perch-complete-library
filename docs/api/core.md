# Core API

`import {ok, err, unknown, unavailable, isOk, makeDiagnosticSink, TextDispatchScheduler} from 'perch-complete-library/core'`

`Outcome<T>` is `{kind:'ok',value:T}` or `{kind:'error',error:PortError}` or `{kind:'unknown',reason:string}` or `{kind:'unavailable',reason:string}`. Never interpret `unknown` as a failed native operation or retry automatically. `PortError` contains `code`, `recoverability` and a bounded safe message.

`TextDispatchScheduler` schedules the injected text binder; dispatch kinds `foreground`/`background-compaction` have bounded concurrency and orphan accounting. `dispatch(opts,hooks)` returns an immediate `Outcome` whose successful value has `operationId`, a completion promise and `stop()` capability. `stop` requests host cancellation and is **not** proof remote computation stopped.

`makeDiagnosticSink()` returns an in-memory sink for bounded test/demo use; **it is not an unbounded production telemetry backend**. Consumers must enforce retention limits and avoid raw prompt, image, authentication or user-record payloads.
