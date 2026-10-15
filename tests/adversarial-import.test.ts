import { DraftStore, type KvFolderLike } from '../src/kv/store.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { newConversation, type CharacterRecord, type ConversationRecord } from '../src/chat/model.js';
import {exportLocal,importLocal,verifyBundle,shaHex, type PortableBundle} from '../src/kv/portable.js';
import {canonicalJson,H} from '../src/kv/canonical.js';

type D={characters:CharacterRecord;conversations:ConversationRecord};
const defs={characters:{folder:'characters',schemaMajor:1,validate:(v:unknown):v is CharacterRecord=>!!v&&typeof v==='object'&&typeof (v as CharacterRecord).incarnationId==='string'},conversations:{folder:'conversations',schemaMajor:1,validate:(v:unknown):v is ConversationRecord=>!!v&&typeof v==='object'&&typeof (v as ConversationRecord).characterId==='string'&&Array.isArray((v as ConversationRecord).turns)}};
function world(){const fs=new Map<string,FakeKvFolder>();const folder=(x:string):FakeKvFolder=>{let a=fs.get(x);if(!a){a=new FakeKvFolder();fs.set(x,a);}return a;};const store=new DraftStore<D>(folder,defs);return {folder,store,opts:{targetSlug:'destination',folders:folder as (f:string)=>KvFolderLike,folderOf:(d:string)=>d}};}
async function fixture(){const src=world();const character:CharacterRecord={id:'c1',incarnationId:'source-incarnation',name:'Source',systemPrompt:'Source instructions'};const conv=newConversation('x1',character);if((await src.store.commit('characters','c1',null,character)).kind!=='ok')throw Error('character setup');if((await src.store.commit('conversations','x1',null,conv)).kind!=='ok')throw Error('conversation setup');const result=await exportLocal(src.store,['conversations','characters'],'source',src.folder,d=>d);if(result.kind!=='ok')throw Error('export');return result.value;}
function assertion(condition:unknown,msg:string):asserts condition{if(!condition)throw Error(msg);}
// Collision and replay: no cross-character rebinding, same source reimport is idempotent.
{
 const archive=await fixture(),dest=world();await dest.store.commit('characters','c1',null,{id:'c1',incarnationId:'unrelated-inc',name:'UNRELATED',systemPrompt:'Not source'});
 const first=await importLocal(dest.store,archive,'merge',dest.opts);
 assertion(first.kind==='ok'&&first.value.state==='complete'&&first.value.inserted===2&&first.value.remapped===1,'initial collision import '+JSON.stringify(first));
 const conv=await dest.store.load('conversations','x1');assertion(conv.kind==='ok'&&conv.value?.value,'conversation inserted');
 const importedId=conv.value.value.characterId;
 assertion(importedId!=='c1'&&importedId.startsWith('imp-'),'dependency was not remapped');
 const imported=await dest.store.load('characters',importedId);assertion(imported.kind==='ok'&&imported.value?.value,'remapped character absent');
 assertion(imported.value.value.incarnationId==='source-incarnation','wrong character identity');
 const unrelated=await dest.store.load('characters','c1');assertion(unrelated.kind==='ok'&&unrelated.value?.value?.name==='UNRELATED','existing character modified');
 const replay=await importLocal(dest.store,archive,'merge',dest.opts);assertion(replay.kind==='ok'&&replay.value.state==='complete'&&replay.value.inserted===0&&replay.value.resumed===2,'replay not idempotent '+JSON.stringify(replay));
 const list=await dest.store.list('characters');assertion(list.kind==='ok'&&list.value.summaries.length===2,'unexpected fork on replay');
}
// Reversed part order accepted: dependency must be applied before conversation regardless of order.
{
 const b=await fixture();
 const entries=b.parts.map(p=>({name:p.name,data:JSON.parse(p.data) as unknown[]}));
 if(entries.length===1){const records=entries[0]!.data;const conv=records.find(x=>(x as {domain:string}).domain==='conversations');const char=records.find(x=>(x as {domain:string}).domain==='characters');assertion(conv&&char,'fixtures');
  b.parts=[{name:'part-001.json',data:JSON.stringify([conv])},{name:'part-002.json',data:JSON.stringify([char])}];
  b.index.partDigests=await Promise.all(b.parts.map(async p=>({name:p.name,sha256:await shaHex(p.data),bytes:new TextEncoder().encode(p.data).length,recordCount:1})));
  const {rootDigest:_previous,...rest}=b.index; b.index.rootDigest=await H('bundle-root-v1',canonicalJson(rest));
 }
 const dest=world();const r=await importLocal(dest.store,b,'merge',dest.opts);assertion(r.kind==='ok'&&r.value.state==='complete','reverse parts import '+JSON.stringify(r));
 const c=await dest.store.load('conversations','x1');assertion(c.kind==='ok'&&c.value?.value?.characterIncarnationId==='source-incarnation','reverse-order dependency lost');
}
// Tampered last part must be rejected before ANY destination mutation.
{
 const b=await fixture();b.parts[b.parts.length-1]!.data+=' ';
 const dest=world();const r=await importLocal(dest.store,b,'merge',dest.opts);assertion(r.kind==='error'&&r.error.code==='IMPORT_INVALID','tamper accepted');
 assertion((await dest.folder('characters').keys()).length===0&&(await dest.folder('conversations').keys()).length===0,'mutated before validation');
}
// Failed character insert must prevent dependent conversation from being stored or misbound.
{
 const b=await fixture();const dest=world();dest.folder('characters').failNext='write';
 const r=await importLocal(dest.store,b,'merge',dest.opts);assertion(r.kind==='ok'&&r.value.state==='partial'&&r.value.remaining>0,'expected failed insert');
 const c=await dest.store.load('conversations','x1');assertion(c.kind==='ok'&&!c.value,'dangling dependent inserted');
}
// Missing source character is an intentionally detached snapshot, never auto-attached by name.
{
 const source=world();const snapshot:CharacterRecord={id:'orphan',incarnationId:'gone',name:'Gone',systemPrompt:'Earlier'};
 const conv=newConversation('detached',snapshot);conv.characterState='detached';await source.store.commit('conversations','detached',null,conv);
 const x=await exportLocal(source.store,['conversations'],'source',source.folder,d=>d);assertion(x.kind==='ok','detached export');
 const dest=world();const r=await importLocal(dest.store,x.value,'merge',dest.opts);assertion(r.kind==='ok'&&r.value.state==='complete','detached import');
 const c=await dest.store.load('conversations','detached');assertion(c.kind==='ok'&&c.value?.value?.characterState==='detached','detached state lost');
}
console.log('PASS adversarial imports, dependencies, replay, mutation and detached records');
