// S3-13 A/B action reducers — 23 actions, pure + store-backed where needed.
import { newConversation, ancestorChain, type ConversationRecord, type CharacterRecord } from '../../../src/chat/model.js';

export type ActionResult = { ok: boolean; code?: string; detail?: string };

let idCounter = 0;
function nid(p: string): string { return p + '-' + (++idCounter); }

// A01 character CRUD (tombstone barrier enforced by store; here pure check)
export function a01_createCharacter(name: string): ActionResult {
  if (!name.trim() || name.length > 64) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, detail: nid('char') };
}
// A02 new conversation
export function a02_newConversation(char: CharacterRecord): { ok:true; conv: ConversationRecord } {
  return { ok:true, conv: newConversation(nid('conv'), char) };
}
// A03 switch (retain draft, view token)
export function a03_switch(currentDraft: string, targetId: string, knownIds: string[]): ActionResult & { retainedDraft?: string } {
  if (!knownIds.includes(targetId)) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, retainedDraft: currentDraft };
}
// A04 send (validate nonblank, slot)
export function a04_send(prompt: string, busy: boolean): ActionResult {
  if (!prompt.trim()) return { ok:false, code:'BAD_INPUT' };
  if (busy) return { ok:false, code:'TEXT_DISPATCH_LIMIT' };
  return { ok:true, detail: nid('op') };
}
// A05 stop
export function a05_stop(active: boolean, stopThrows: boolean): ActionResult {
  if (!active) return { ok:false, code:'BAD_INPUT' };
  if (stopThrows) return { ok:true, detail:'unknown (stop threw, view detached)' };
  return { ok:true, detail:'detached' };
}
// A06 regenerate
export function a06_regenerate(orphans: number): ActionResult {
  if (orphans >= 2) return { ok:false, code:'TEXT_DISPATCH_LIMIT' };
  return { ok:true, detail: nid('op') };
}
// A07 edit/branch/steer
export function a07_edit(turns: Array<{ id: string; parentTurnId: string | null }>, targetId: string): ActionResult {
  try { ancestorChain(turns, targetId); return { ok:true, detail: nid('rev') }; }
  catch { return { ok:false, code:'BAD_INPUT' }; }
}
// A08 export/import (merge-only, no replace)
export function a08_import(mode: string): ActionResult {
  if (mode !== 'merge') return { ok:false, code:'IMPORT_INVALID' };
  return { ok:true };
}
// A09 open room
export function a09_openRoom(channel: string, hasActive: boolean): ActionResult {
  if (!channel) return { ok:false, code:'ROOM_CHANNEL_INVALID' };
  return { ok:true, detail: hasActive ? 'released previous' : 'mounted' };
}
// A10 custom send (custom-qualified only)
export function a10_sendCustom(mode: string, text: string): ActionResult {
  if (mode !== 'custom-qualified') return { ok:false, code:'ROOM_NOT_READY' };
  if (!text.trim()) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, detail:'invoked (not delivered)' };
}
// A11 settings save
export function a11_settings(valid: boolean): ActionResult {
  if (!valid) return { ok:false, code:'BAD_INPUT' };
  return { ok:true };
}
// A12 retry (nonmutating only)
export function a12_retry(mutating: boolean): ActionResult {
  if (mutating) return { ok:false, code:'BAD_INPUT' };
  return { ok:true };
}
// B01 preset
export function b01_preset(title: string): ActionResult {
  if (!title.trim()) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, detail: nid('preset') };
}
// B02 edit prompt (local only, no dispatch)
export function b02_editPrompt(): ActionResult { return { ok:true, detail:'local form' }; }
// B03 tile (host cap)
export function b03_tile(liveHosts: number): ActionResult {
  if (liveHosts >= 4) return { ok:false, code:'IMAGE_DISPATCH_LIMIT' };
  return { ok:true, detail: nid('tile') };
}
// B04 data
export function b04_data(valid: boolean): ActionResult {
  if (!valid) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, detail: nid('job') };
}
// B05 gallery
export function b05_gallery(): ActionResult { return { ok:true }; }
// B06 favorite/toggle (never evict unknown)
export function b06_favorite(resultKind: string): ActionResult {
  if (resultKind==='unknown'||resultKind==='pending') return { ok:true, detail:'protected' };
  return { ok:true };
}
// B07 portable
export function b07_portable(mode: string): ActionResult {
  if (mode!=='merge') return { ok:false, code:'IMPORT_INVALID' };
  return { ok:true };
}
// B08 download (only when available)
export function b08_download(state: string): ActionResult {
  if (state!=='available') return { ok:false, code:'BAD_INPUT' };
  return { ok:true };
}
// B09 regenerate (warn if uncertain)
export function b09_regenerate(uncertain: boolean): ActionResult {
  return { ok:true, detail: uncertain ? 'warned' : 'new job' };
}
// B10 settings
export function b10_settings(valid: boolean): ActionResult {
  if (!valid) return { ok:false, code:'BAD_INPUT' };
  return { ok:true };
}
// B11 gallery customButton (validate before draft)
export function b11_galleryClick(payload: {prompt?: string; seed?: number}): ActionResult {
  if (payload.prompt !== undefined && typeof payload.prompt !== 'string') return { ok:false, code:'BAD_INPUT' };
  if (payload.seed !== undefined && !Number.isInteger(payload.seed)) return { ok:false, code:'BAD_INPUT' };
  return { ok:true, detail:'draft loaded' };
}

export const ALL_23 = ['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10','A11','A12','B01','B02','B03','B04','B05','B06','B07','B08','B09','B10','B11'];
