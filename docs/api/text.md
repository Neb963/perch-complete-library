# Text API

`bindText(backend: NativeBackend | null, diag?)` returns the selected text port. It does not start generation when imported or bound. `NativeBackend` supplies `metadata()` and `startNative(options, hooks)`; native callback sequencing and stop behavior are normalized into `TextRequest`.

`TextOptions`: `instruction` string or supported multimodal list, optional `startWith`, `stopSequences` and `prefixVisibility`. `TextRequest` exposes an `operationId`, `completion: Promise<Outcome<TextFinal>>`, `requestStop()` and `detachView()`. `TextFinal` distinguishes `generatedText` from `visibleText` (prefix rendering). Streaming uses `TextChunk` callbacks.

Use `projectStream`, `stripPrefix` and `truncateStop` for normalization of visible text and stop sequences. Do not assume final-only completions echo a hidden requested prefix. Streaming/final mismatch and malformed native payloads return typed errors. For rate and concurrency limits, see [Core](core.md).
