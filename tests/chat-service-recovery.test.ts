import { ChatService, type ChatDomains } from '../src/app/service.js';
import { DraftStore } from '../src/kv/store.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { newConversation, type CharacterRecord, type ConversationRecord } from '../src/chat/model.js';
import type { NativeBackend } from '../src/text/bindText.js';

function assert(x:unknown,msg:string): asserts x {if(!x)throw Error(msg);}
const defs={
 characters:{folder:'c',schemaMajor:1,validate:(v:unknown):v is CharacterRecord=>!!v&&typeof v==='object'&&typeof (v as CharacterRecord).incarnationId==='string'},
 conversations:{folder:'v',schemaMajor:1,validate:(v:unknown):v is ConversationRecord=>!!v&&typeof v==='object'&&Array.isArray((v as ConversationRecord).turns)&&Array.isArray((v as ConversationRecord).attempts)},
};
function fixture(){const folders=new Map<string,FakeKvFolder>();const f=(name:string)=>{let p=folders.get(name);if(!p){p=new FakeKvFolder();folders.set(name,p);}return p;};return new DraftStore<ChatDomains>(f,defs);}
function backend(instructions:string[], deferred?:{promise:Promise<{generatedText:string}>}):NativeBackend{
 return {metadata:()=>({countTokens:()=>10,idealMaxContextTokens:4096}),startNative:(o)=>{instructions.push(String(o.instruction));return {hybrid:{stop(){}},promise:deferred?.promise??Promise.resolve({generatedText:'Response recorded'})};}};
}
async function load(store:DraftStore<ChatDomains>,id:string){const r=await store.load('conversations',id);assert(r.kind==='ok'&&r.value?.value,'conversation missing');return r.value;}
async function setup(store:DraftStore<ChatDomains>,id:string){const service=new ChatService(store,backend([]));assert((await service.createCharacter('char-'+id,'Ada','Speak briefly','inc-'+id)).ok,'create character');assert((await service.newConversation(id,'char-'+id)).ok,'new conversation');assert((await service.appendUserTurn(id,'Original question')).ok,'append user');return service;}
// Successful completion must persist one final turn and REMOVE the pending attempt.
{
 const store=fixture(), instructions:string[]=[];await setup(store,'ok');
 const service=new ChatService(store,backend(instructions));
 const r=await service.generate('ok','session-1');assert(r.ok,'native completion '+JSON.stringify(r));
 const stored=await load(store,'ok');assert(stored.value!.turns.length===2,'not two durable final turns');
 assert(stored.value!.attempts.length===0,'successful completion falsely left an UNKNOWN attempt');
 assert(instructions[0]?.includes('Original question'),'native request missing persisted context');
 const reloaded=new ChatService(store,backend([]));const post=await reloaded.reconcileInterrupted('ok','session-2');assert(post.ok&&post.changed===0,'settled attempt changed on reload');
}
// Delete character after conversation creation: history accessible, generation forbidden.
{
 const store=fixture();await setup(store,'deleted');
 const r=await store.load('characters','char-deleted');assert(r.kind==='ok'&&r.value,'character missing');
 assert((await store.delete('characters','char-deleted',r.value.revision)).kind==='ok','delete character');
 const called:string[]=[];const service=new ChatService(store,backend(called));
 const result=await service.generate('deleted','another');
 assert(!result.ok&&result.code==='CHARACTER_UNAVAILABLE'&&called.length===0,'dispatched with deleted character');
 assert((await load(store,'deleted')).value?.turns.length===1,'deleted character destroyed history');
}
// Reload in-flight: commit unknown exactly once, never replay native operation.
{
 const store=fixture();await setup(store,'lost');const before=await load(store,'lost');const value=structuredClone(before.value!);
 value.attempts.push({operationId:'op-lost',parentTurnId:value.activeBranchLeafId,branchId:value.activeBranchId,state:'pending',draftText:'partial',originSessionId:'closed-tab',startedAt:'2026-10-14T00:00:00Z'});
 assert((await store.commit('conversations','lost',before.revision,value)).kind==='ok','persist pending attempt');
 const instructions:string[]=[];const service=new ChatService(store,backend(instructions));
 const recovered=await service.reconcileInterrupted('lost','new-tab');assert(recovered.ok&&recovered.changed===1,'pending not reconciled');
 const again=await service.reconcileInterrupted('lost','new-tab');assert(again.ok&&again.changed===0,'reconciled twice');
 const l=await load(store,'lost');assert(l.value?.attempts[0]?.state==='unknown'&&l.value.attempts[0].draftText==='partial','lost provisional draft');
 assert(instructions.length===0,'restart replayed a provider call');
}
// Delete character *during* native generation: late result must not be committed.
{
 const store=fixture();await setup(store,'during');let resolve!:(x:{generatedText:string})=>void;
 const promise=new Promise<{generatedText:string}>(r=>{resolve=r;});
 const svc=new ChatService(store,backend([], {promise}));const work=svc.generate('during','session-x');
 for(let i=0;i<20;i++)await Promise.resolve();
 const ch=await store.load('characters','char-during');assert(ch.kind==='ok'&&ch.value,'character missing');
 assert((await store.delete('characters','char-during',ch.value.revision)).kind==='ok','delete race');
 resolve({generatedText:'Should be rejected'});const outcome=await work;
 assert(!outcome.ok&&outcome.code==='CHARACTER_UNAVAILABLE','accepted stale generation after deletion');
 const after=await load(store,'during');assert(after.value?.turns.length===1,'stale assistant turn leaked into history');
 const reconciled=await svc.reconcileInterrupted('during','new-tab');assert(reconciled.ok&&reconciled.changed===1,'stale in-flight attempt not recovered');
}
console.log('PASS chat service: durable reply, detached guard, reload reconciliation and late-native fencing');
