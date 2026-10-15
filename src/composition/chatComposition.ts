// S3-16 chat composition — real consumer flow:
// bootstrap → text adapter → scheduler → conversation state → generation → KV commit → reload → UI projection.
// Exercises actual implementations with fakes; traces operation IDs + causal diagnostics.
import { DraftStore, type KvFolderLike, type DomainDef } from '../kv/store.js';
import { bindText, type NativeBackend } from '../text/bindText.js';
import { TextDispatchScheduler } from '../core/scheduler.js';
import { createRoomBinder, type RoomMessage } from '../comments/bindRoom.js';
import { newConversation, ancestorChainForConversation } from '../chat/model.js';
import { ok, err, type Outcome } from '../core/outcome.js';

export type ChatCompDeps = {
  folders: (f: string) => KvFolderLike;
  defs: Record<string, DomainDef<unknown>>;
  textBackend: NativeBackend;
  roomFactory: (channel: string, opts: Record<string, unknown>) => { toString(): string; submit?: (t: string) => void; setNicknameForNextComment?: (n: string) => void; setAvatarUrlForNextComment?: (u: string) => void };
  host: unknown;
};

export async function runChatComposition(deps: ChatCompDeps): Promise<{ ok: boolean; steps: string[]; diagnostics: Array<{ op: string; detail: string }> }> {
  const steps: string[] = [];
  const diagnostics: Array<{ op: string; detail: string }> = [];
  const trace = (op: string, detail: string): void => { diagnostics.push({ op, detail }); };
  // 1. bootstrap store with injected folders (same contract as native)
  const store = new DraftStore<Record<string, unknown>>(deps.folders, deps.defs);
  trace('bootstrap', 'store-ready');
  steps.push('store-ready');
  // 2. text adapter + scheduler
  const bt = bindText(deps.textBackend);
  const sch = new TextDispatchScheduler(bt, () => 0);
  // 3. conversation state
  const conv = newConversation('conv-1', { id: 'ch1', incarnationId: 'i1', name: 'Bob', systemPrompt: 'Be helpful' });
  trace('conv', 'new-conversation:' + conv.id);
  steps.push('conv-ready');
  // 4. generation via scheduler (foreground)
  const disp = sch.dispatch({ instruction: 'Say hello as Bob', sessionId: 'sess-1', kind: 'foreground', conversationId: conv.id }, {
    onChunk: (c) => { trace('chunk', c.fullVisibleText.slice(0, 40)); },
  });
  if (disp.kind !== 'ok') throw new Error('dispatch failed: ' + JSON.stringify(disp));
  const opId: string = disp.value.operationId;
  trace('dispatch', opId);
  steps.push('text-dispatched:' + opId);
  const fin: Outcome<{ generatedText: string; visibleText: string }> = await disp.value.completion;
  if (fin.kind !== 'ok') throw new Error('generation failed: ' + JSON.stringify(fin));
  trace('generated', fin.value.generatedText.slice(0, 60));
  steps.push('text-generated:' + fin.value.generatedText.length);
  // 5. Commit an ACTUAL conversation snapshot using the selected store contract.
  const domain = Object.hasOwn(deps.defs,'conversations') ? 'conversations' : Object.keys(deps.defs)[0];
  if (!domain) throw new Error('conversation domain unavailable');
  const withTurns = {
    ...conv,
    turns: [
      { id:'t1', parentTurnId:null, branchId:'b1', speaker:{ kind:'user' as const,participantId:'u1',displayName:'User'},text:'hi',revision:1,status:'final' as const },
      { id:'t2', parentTurnId:'t1', branchId:'b1', speaker:{ kind:'ai' as const,participantId:'a1',displayName:'Bob'},text:fin.value.generatedText,revision:1,status:'final' as const },
    ],
    activeBranchLeafId:'t2',
  };
  const saved = await store.commit(domain, conv.id, null, withTurns);
  if(saved.kind!=='ok')throw new Error('conversation persist: '+JSON.stringify(saved));
  const savedLoad=await store.load(domain,conv.id);
  if(savedLoad.kind!=='ok'||!savedLoad.value?.value)throw new Error('conversation post-commit load');
  const chain=ancestorChainForConversation(savedLoad.value.value as typeof withTurns,'t2');
  if(chain.length!==2||chain[1]?.text!==fin.value.generatedText)throw new Error('persistent ancestry/projection');
  steps.push('kv-committed-and-loaded:'+saved.value.revision);
  trace('kv','committed-revision='+saved.value.revision);
  // 6. room mount + callbacks + submit (human room leg)
  const binder = createRoomBinder(deps.roomFactory);
  const seen: RoomMessage[] = [];
  const m = binder.mount(
    { channel: 'plr1-test', host: deps.host, presentation: 'custom-qualified' },
    { onInitial: (xs) => { seen.push(...xs); }, onMessage: (x) => { seen.push(x); } },
  );
  if (m.kind !== 'ok') throw new Error('room mount: ' + JSON.stringify(m));
  steps.push('room-mounted');
  trace('room', 'mounted plr1-test');
  // Simulate native initial + incoming (wired callbacks must deliver to projection)
  m.value.dispatchInitial([{ localId: 'm1', bodyUnsafe: 'hello <b>world</b>' }]);
  m.value.dispatchMessage({ localId: 'm2', bodyUnsafe: 'second' });
  // Duplicate must be ignored exactly-once
  m.value.dispatchMessage({ localId: 'm2', bodyUnsafe: 'second' });
  if (seen.length !== 2) throw new Error('room projection expected 2, got ' + seen.length);
  steps.push('room-projected:' + seen.length);
  const sub = await m.value.submit('hello from test');
  if (sub.kind !== 'invoked' && sub.kind !== 'unknown') throw new Error('submit: ' + JSON.stringify(sub));
  steps.push('room-submitted:' + sub.kind);
  trace('submit', sub.kind + ':' + sub.localOperationId);
  // 7. reload simulation: re-create store view over same folders, verify persisted + projected state survives
  const store2 = new DraftStore<Record<string, unknown>>(deps.folders, deps.defs);
  const reloaded = await store2.load(domain,conv.id);
  if(reloaded.kind!=='ok'||!reloaded.value?.value)throw new Error('reload lost persisted conversation');
  const restored = reloaded.value.value as typeof withTurns;
  const restoredChain=ancestorChainForConversation(restored,restored.activeBranchLeafId);
  if(restoredChain.length!==2||restoredChain[1]?.text!==fin.value.generatedText)throw new Error('reload altered transcript');
  steps.push('reload-persistent-verified');
  trace('reload', 'persisted-turns='+restoredChain.length);
  // 8. stop path (orphan accounting)
  disp.value.stop();
  steps.push('text-stopped');
  if (steps.length < 8) throw new Error('steps');
  void ok;
  void err;
  return { ok: true, steps, diagnostics };
}
