// S3-13 chat service — connects A01-A12 reducers to real state, storage, scheduler, UI projection.
// Pure reducers validate; this service owns persistence + dispatch + reload.
import { DraftStore } from '../kv/store.js';
import { bindText, type NativeBackend } from '../text/bindText.js';
import { TextDispatchScheduler } from '../core/scheduler.js';
import { newConversation, buildPrompt, effectiveLink, type CharacterRecord, type ConversationRecord } from '../chat/model.js';

export type ChatDomains = {
  characters: CharacterRecord;
  conversations: ConversationRecord;
};

export class ChatService {
  private scheduler: TextDispatchScheduler;
  constructor(
    private readonly store: DraftStore<ChatDomains>,
    backend: NativeBackend,
    now?: (() => number) | undefined,
  ) {
    const bt = bindText(backend);
    this.scheduler = new TextDispatchScheduler(bt, now ?? (() => Date.now()));
  }

  async createCharacter(id: string, name: string, systemPrompt: string, incarnationId?: string | undefined): Promise<{ ok: boolean; code?: string | undefined }> {
    if (!name.trim() || name.length > 64) return { ok: false, code: 'BAD_INPUT' };
    const rec: CharacterRecord = { id, incarnationId: incarnationId ?? ('inc-' + id), name, systemPrompt };
    const r = await this.store.commit('characters', id, null, rec);
    if (r.kind !== 'ok') return { ok: false, code: r.kind === 'error' ? r.error.code : r.kind };
    return { ok: true };
  }

  async getCharacter(id: string): Promise<CharacterRecord | null> {
    const l = await this.store.load('characters', id);
    if (l.kind !== 'ok' || l.value === null || l.value.deleted) return null;
    const v = l.value.value;
    if (v === null) return null;
    return v;
  }

  async newConversation(convId: string, characterId: string): Promise<{ ok: boolean; code?: string | undefined }> {
    const c = await this.getCharacter(characterId);
    if (!c) return { ok: false, code: 'BAD_INPUT' };
    const conv = newConversation(convId, c);
    const r = await this.store.commit('conversations', convId, null, conv);
    if (r.kind !== 'ok') return { ok: false, code: r.kind === 'error' ? r.error.code : r.kind };
    return { ok: true };
  }

  async appendUserTurn(convId: string, text: string): Promise<{ ok: boolean; code?: string | undefined }> {
    if (!text.trim()) return { ok: false, code: 'BAD_INPUT' };
    const l = await this.store.load('conversations', convId);
    if (l.kind !== 'ok' || !l.value || l.value.deleted) return { ok: false, code: 'BAD_INPUT' };
    const rawVal = l.value.value;
    if (rawVal === null) return { ok: false, code: 'STORE_CORRUPT' };
    const conv = structuredClone(rawVal);
    const turnId = 't-' + conv.turns.length + '-' + Date.now().toString(36);
    conv.turns.push({ id: turnId, parentTurnId: conv.activeBranchLeafId, branchId: conv.activeBranchId, speaker: { kind: 'user', participantId: 'u1', displayName: 'User' }, text, revision: 1, status: 'final' });
    conv.activeBranchLeafId = turnId;
    const r = await this.store.commit('conversations', convId, l.value.revision, conv);
    if (r.kind !== 'ok') return { ok: false, code: r.kind === 'error' ? r.error.code : r.kind };
    return { ok: true };
  }

  // Generation: persist pending attempt via CAS before dispatch (E3), then dispatch, then commit final turn.
  async generate(convId: string, sessionId: string): Promise<{ ok: boolean; code?: string | undefined; text?: string | undefined }> {
    const l = await this.store.load('conversations', convId);
    if (l.kind !== 'ok' || !l.value || l.value.deleted) return { ok: false, code: 'BAD_INPUT' };
    const lv = l.value.value;
    if (lv === null) return { ok: false, code: 'STORE_CORRUPT' };
    // The persisted 'linked' flag is only an advisory snapshot. Never dispatch
    // against a deleted or replaced character incarnation.
    const character = await this.store.load('characters', lv.characterId);
    if (character.kind !== 'ok' || effectiveLink(character.value, lv) !== 'linked')
      return { ok: false, code: 'CHARACTER_UNAVAILABLE' };
    const conv = structuredClone(lv);
    const opId = 'op-' + Date.now().toString(36) + '-' + conv.attempts.length;
    conv.attempts.push({ operationId: opId, parentTurnId: conv.activeBranchLeafId, branchId: conv.activeBranchId, state: 'pending', draftText: '', originSessionId: sessionId, startedAt: new Date().toISOString() });
    const pre = await this.store.commit('conversations', convId, l.value.revision, conv);
    if (pre.kind !== 'ok') return { ok: false, code: pre.kind === 'error' ? pre.error.code : pre.kind };
    const prompt = buildPrompt(conv);
    const disp = this.scheduler.dispatch({ instruction: prompt || 'hello', sessionId, kind: 'foreground', conversationId: convId });
    if (disp.kind !== 'ok') {
      // Mark attempt failed (bounded reconciliation, no auto-replay).
      const l2 = await this.store.load('conversations', convId);
      if (l2.kind === 'ok' && l2.value && !l2.value.deleted && l2.value.value !== null) {
        const c2 = structuredClone(l2.value.value);
        const a = c2.attempts.find(x => x.operationId === opId);
        if (a) { a.state = 'failed'; a.errorCode = 'TEXT_DISPATCH_LIMIT'; await this.store.commit('conversations', convId, l2.value.revision, c2); }
      }
      return { ok: false, code: 'TEXT_DISPATCH_LIMIT' };
    }
    const fin = await disp.value.completion;
    const l3 = await this.store.load('conversations', convId);
    if (l3.kind !== 'ok' || !l3.value || l3.value.deleted || l3.value.value === null) return { ok: false, code: 'STORE_UNAVAILABLE' };
    const c3 = structuredClone(l3.value.value);
    // A user may have edited/branched/steered during the native request.
    // Reject stale placement instead of attaching the reply to a new leaf.
    if (c3.activeBranchLeafId !== conv.activeBranchLeafId || c3.activeBranchId !== conv.activeBranchId)
      return { ok: false, code: 'REVISION_CONFLICT' };
    const linkNow = await this.store.load('characters', c3.characterId);
    if (linkNow.kind !== 'ok' || effectiveLink(linkNow.value, c3) !== 'linked')
      return { ok: false, code: 'CHARACTER_UNAVAILABLE' };
    const att = c3.attempts.find(x => x.operationId === opId);
    if (fin.kind !== 'ok') {
      if (att) { att.state = 'failed'; att.errorCode = fin.kind === 'error' ? fin.error.code : fin.kind; await this.store.commit('conversations', convId, l3.value.revision, c3); }
      return { ok: false, code: fin.kind === 'error' ? fin.error.code : fin.kind };
    }
    const turnId = 't-ai-' + Date.now().toString(36);
    c3.turns.push({ id: turnId, parentTurnId: c3.activeBranchLeafId, branchId: c3.activeBranchId, speaker: { kind: 'ai', participantId: 'a1', displayName: c3.characterSnapshot.name }, text: fin.value.generatedText, revision: 1, status: 'final', originOperationId: opId });
    c3.activeBranchLeafId = turnId;
    // Successful assistant turns have their own durable originOperationId.
    // An attempt history is for unresolved/failed requests, never a false 'unknown' success.
    c3.attempts = c3.attempts.filter(x => x.operationId !== opId);
    const done = await this.store.commit('conversations', convId, l3.value.revision, c3);
    if (done.kind !== 'ok') return { ok: false, code: 'REVISION_CONFLICT' };
    return { ok: true, text: fin.value.generatedText };
  }

  // Page-reload reconciliation. Only nonlocal in-flight attempts become unknown;
  // a reload does not claim native cancellation or automatically replay anything.
  async reconcileInterrupted(convId: string, currentSessionId: string): Promise<{ok:boolean; changed:number; code?:string}> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await this.store.load('conversations', convId);
      if (loaded.kind !== 'ok') return {ok:false,changed:0,code:loaded.kind==='error'?loaded.error.code:'STORE_UNAVAILABLE'};
      if (!loaded.value || loaded.value.deleted || !loaded.value.value) return {ok:false,changed:0,code:'BAD_INPUT'};
      const c=structuredClone(loaded.value.value);
      let changed=0;
      for(const a of c.attempts){
        if(a.originSessionId!==currentSessionId && (a.state==='pending'||a.state==='stop_requested')) {
          a.state='unknown';a.finishedAt=new Date().toISOString();changed++;
        }
      }
      if(changed===0)return {ok:true,changed:0};
      const result=await this.store.commit('conversations',convId,loaded.value.revision,c);
      if(result.kind==='ok')return {ok:true,changed};
      if(result.kind!=='error'||result.error.code!=='REVISION_CONFLICT')return {ok:false,changed:0,code:result.kind==='error'?result.error.code:'STORE_UNAVAILABLE'};
    }
    return {ok:false,changed:0,code:'REVISION_CONFLICT'};
  }

}
