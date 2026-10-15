# Chat and character domain API

`CharacterRecord` has stable `id`, changing `incarnationId`, name and system prompt. `ConversationRecord` owns turns, attempts, branch ancestry, summary boundary, draft and a saved character snapshot. `effectiveLink` determines linked/detached state even after character deletion; deleted references must not silently bind to replacement records.

`newConversation(id,character)` creates the domain record. `ancestorChainForConversation` and `buildPrompt` traverse selected branch ancestors, including a summarized history boundary; they do not replay or rewrite history.

`ChatService(store: DraftStore<ChatDomains>, scheduler: TextDispatchScheduler)` exposes `createCharacter`, `getCharacter`, `newConversation`, `appendUserTurn`, `generate` and `reconcileInterrupted`. It persists a pending operation before dispatching the native text provider, commits only results that still belong to the same incarnation/branch and marks abandoned pending operations `unknown` on reload without automatic replay.

**Scope:** the exported service is a lifecycle/domain service, not a full group-chat UI/controller; character management and branch editing views remain application-owned. Future UI must consume this model through explicit APIs.
