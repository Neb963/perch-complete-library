# Comments and room API

`createRoomBinder(nativeFactory)` binds the selected native comments factory. `mount({channel,host,presentation,...}, {onInitial,onMessage})` attaches the native iframe, subscribes through documented `onLoad`/`onComment` options and returns `Outcome<RoomHandle>`. Presentation modes are `native` and `custom-qualified`; custom sends remain gated by applicable qualification.

`RoomHandle.submit(text,opts)` returns `RoomSubmission` (`invoked | unknown | error`). `invoked` confirms only the native submission method was called, **not** server delivery. Do not synthesize successes from missing native methods. The library serializes identity setters with the native submission invocation; disposed or replaced rooms fence callbacks. `disposeHost()` releases a mount. Incoming `bodyUnsafe` is untrusted markup and must be escaped/sanitized before custom rendering; `renderMessageSafe` is a conservative safe representation, not an HTML whitelist.

`validateRoomKey`, `appChannelBase` and `parseChannel` validate channel ownership. Delayed native initial-load callbacks must not be treated as immediate failures without explicit timeout policies.
