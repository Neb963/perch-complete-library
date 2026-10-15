// Actual Stage 3 generator entry. No provider calls at boot.
// Manual actions exercise the SAME ordinary modules included in the production bundle.
import { DraftStore, bindKv, type DomainDef } from '../kv/store.js';
import { newConversation, ancestorChainForConversation, effectiveLink, buildPrompt, type CharacterRecord, type ConversationRecord } from '../chat/model.js';
import { bindText, type NativeBackend } from '../text/bindText.js';
import { TextDispatchScheduler } from '../core/scheduler.js';
import { createRoomBinder, type NativeRoomInstance, type RoomHandle } from '../comments/bindRoom.js';
import { bindImage, type NativeImageBackend } from '../image/bindImage.js';
import { JobStore } from '../image/jobs.js';
import { bindGallery } from '../image/gallery.js';
import { exportLocal, importLocal, verifyBundle } from '../kv/portable.js';

declare const root: {kv:Record<string,unknown>;generateText:(opts:Record<string,unknown>)=>unknown;generateImage:(opts:Record<string,unknown>)=>unknown;commentsPlugin:(opts:Record<string,unknown>)=>NativeRoomInstance};
const el=document.getElementById('app-root');
if(!el)throw Error('APP_ROOT_MISSING');
const id=window.__pcBoot?.buildId??'unknown';
const events:Array<Record<string,unknown>>=[];
let sequence=0;
function log(event:string,data:Record<string,unknown>={}):void{
 const safe=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='string'?v.slice(0,200):v]));
 events.push({seq:++sequence,buildId:id,event,...safe});if(events.length>1000)events.shift();
 const dst=document.getElementById('app-log');if(dst)dst.textContent=events.slice(-24).map(x=>JSON.stringify(x)).join('\n');
}
function button(label:string,action:()=>void):HTMLButtonElement{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{try{action();}catch(e){log('UI_EXCEPTION',{error:String(e)})}});return b;}
function section(title:string):HTMLElement{const s=document.createElement('section');const h=document.createElement('h3');h.textContent=title;s.appendChild(h);el!.appendChild(s);return s;}
function input(placeholder:string):HTMLInputElement{const f=document.createElement('input');f.placeholder=placeholder;return f;}
function text(placeholder:string):HTMLTextAreaElement{const f=document.createElement('textarea');f.placeholder=placeholder;return f;}
async function guarded(name:string,job:()=>Promise<void>):Promise<void>{try{await job();}catch(e){log('FAIL',{action:name,error:String(e)})}}
const defs:{characters:DomainDef<CharacterRecord>;conversations:DomainDef<ConversationRecord>}={
 characters:{folder:'plstage3characters',schemaMajor:1,validate:(v):v is CharacterRecord=>!!v&&typeof v==='object'&&typeof (v as CharacterRecord).id==='string'&&typeof (v as CharacterRecord).incarnationId==='string'&&typeof (v as CharacterRecord).name==='string'&&typeof (v as CharacterRecord).systemPrompt==='string'},
 conversations:{folder:'plstage3conversations',schemaMajor:1,validate:(v):v is ConversationRecord=>!!v&&typeof v==='object'&&Array.isArray((v as ConversationRecord).turns)&&Array.isArray((v as ConversationRecord).attempts)&&typeof (v as ConversationRecord).characterId==='string'},
};
const b=bindKv<{characters:CharacterRecord;conversations:ConversationRecord}>(root,defs);
if(b.kind!=='ok')throw Error('NATIVE_KV_BINDING:'+JSON.stringify(b));
const store:DraftStore<{characters:CharacterRecord;conversations:ConversationRecord}>=b.value;
const charId='stage3char',conversationId='stage3conv';
const textBackend:NativeBackend={
 metadata:()=>{const v=root.generateText({getMetaObject:true}) as {countTokens?:(s:string)=>number;idealMaxContextTokens?:number};if(typeof v?.countTokens!=='function')throw Error('NATIVE_METADATA_INVALID');return {countTokens:v.countTokens,idealMaxContextTokens:v.idealMaxContextTokens??4096};},
 startNative:(opts,hooks)=>{const p=root.generateText({...opts,onChunk:hooks.onChunk,onFinish:hooks.onFinish});if(!p||typeof (p as Promise<unknown>).then!=='function')throw Error('NATIVE_TEXT_NOT_THENABLE');return {hybrid:p as {stop?:()=>void},promise:Promise.resolve(p)};},
};
const scheduler=new TextDispatchScheduler(bindText(textBackend,(x)=>log('TEXT_DIAG',x)));
let room:RoomHandle|null=null;
el.replaceChildren();const heading=document.createElement('h2');heading.textContent='Perchance Libraries — integrated Stage 3';el.appendChild(heading);
const desc=document.createElement('p');desc.textContent='Actual compiled libraries. Provider calls are only made by explicit clicks. Use disposable preview workspace.';el.appendChild(desc);
const storage=section('Persistent chat / text');
const message=text('Type one short sentence for a controlled text-generation test');storage.appendChild(message);
storage.appendChild(button('Create or reload conversation',()=>void guarded('open',async()=>{
 const c=await store.load('characters',charId);
 if(c.kind!=='ok')throw Error(JSON.stringify(c));
 if(!c.value){const cv:CharacterRecord={id:charId,incarnationId:'stage3-identity-1',name:'Test',systemPrompt:'Reply briefly.'};const r=await store.commit('characters',charId,null,cv);if(r.kind!=='ok')throw Error(JSON.stringify(r));}
 const v=await store.load('conversations',conversationId);
 if(v.kind!=='ok')throw Error(JSON.stringify(v));
 if(!v.value){const nc=newConversation(conversationId,{id:charId,incarnationId:'stage3-identity-1',name:'Test',systemPrompt:'Reply briefly.'});const r=await store.commit('conversations',conversationId,null,nc);if(r.kind!=='ok')throw Error(JSON.stringify(r));}
 const latest=await store.load('conversations',conversationId);log('CONVERSATION_LOADED',{revision:latest.kind==='ok'?latest.value?.revision:'error'});
})));
storage.appendChild(button('Send one bounded text request',()=>void guarded('text',async()=>{
 const prompt=message.value.trim();if(!prompt||prompt.length>300)throw Error('INPUT_MUST_BE_1_TO_300_CHARS');
 const l=await store.load('conversations',conversationId);if(l.kind!=='ok'||!l.value||!l.value.value)throw Error('CREATE_CONVERSATION_FIRST');
 const conv=l.value.value;
 const currentCharacter=await store.load('characters',conv.characterId);
 if(currentCharacter.kind!=='ok'||effectiveLink(currentCharacter.value,conv)!=='linked')throw Error('CHARACTER_UNAVAILABLE_OR_REPLACED');
 const turnId='u-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
 const userTurn={id:turnId,parentTurnId:conv.activeBranchLeafId,branchId:conv.activeBranchId,speaker:{kind:'user' as const,participantId:'u1',displayName:'User'},text:prompt,revision:1,status:'final' as const};
 const next={...conv,turns:[...conv.turns,userTurn],activeBranchLeafId:turnId};
 const wr=await store.commit('conversations',conversationId,l.value.revision,next);if(wr.kind!=='ok')throw Error(JSON.stringify(wr));
 const chain=ancestorChainForConversation(next,next.activeBranchLeafId);
 const assembled=buildPrompt(next);
 if(!chain.some(t=>t.id===turnId)||!assembled.includes(prompt))throw Error('CHAT_PROMPT_ASSEMBLY_INCONSISTENT');
 const instruction='Character: '+conv.characterSnapshot.systemPrompt+'\n<MESSAGES>\n'+assembled+'\n</MESSAGES>\nTASK: Reply in one short sentence.';
 const dispatch=scheduler.dispatch({instruction,kind:'foreground',sessionId:'stage3-preview',conversationId});
 if(dispatch.kind!=='ok')throw Error(JSON.stringify(dispatch));
 log('TEXT_STARTED',{operationId:dispatch.value.operationId,contextTurns:chain.length});
 const final=await dispatch.value.completion;if(final.kind!=='ok')throw Error(JSON.stringify(final));
 const current=await store.load('conversations',conversationId);if(current.kind!=='ok'||!current.value?.value)throw Error('CHAT_READBACK_MISSING');
 const aiId='a-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),u=current.value.value;
 const aiTurn={id:aiId,parentTurnId:u.activeBranchLeafId,branchId:u.activeBranchId,speaker:{kind:'ai' as const,participantId:'a1',displayName:'Test'},text:final.value.generatedText,revision:1,status:'final' as const};
 const res=await store.commit('conversations',conversationId,current.value.revision,{...u,turns:[...u.turns,aiTurn],activeBranchLeafId:aiId});
 if(res.kind!=='ok')throw Error(JSON.stringify(res));log('TEXT_COMMITTED',{operationId:dispatch.value.operationId,length:final.value.generatedText.length,revision:res.value.revision});
})));
storage.appendChild(button('Reload persisted chat',()=>void guarded('reload',async()=>{
 const r=await store.load('conversations',conversationId);if(r.kind!=='ok'||!r.value?.value)throw Error('CHAT_MISSING');
 const chain=ancestorChainForConversation(r.value.value,r.value.value.activeBranchLeafId);log('CHAT_RELOADED',{revision:r.value.revision,turns:chain.length});
})));
const human=section('Native comments (isolated channel)');
const channel=input('Channel (use a disposable channel)');channel.value='plstage3-preview-diagnostic';human.appendChild(channel);
const roomHost=document.createElement('div');human.appendChild(roomHost);
human.appendChild(button('Mount native room (read-only)',()=>{
 room?.disposeHost();const r=createRoomBinder((_ch,opts)=>root.commentsPlugin(opts)).mount({channel:channel.value,host:roomHost,presentation:'native',width:'100%',height:260},{onInitial:xs=>log('ROOM_INITIAL',{count:xs.length}),onMessage:x=>log('ROOM_INCOMING',{messageId:x.localId})});
 if(r.kind!=='ok')log('ROOM_MOUNT_ERROR',{kind:r.kind});else{room=r.value;log('ROOM_MOUNTED',{channel:channel.value});}
}));
const image=section('Native image / gallery');
const imageHost=document.createElement('div');const galleryHost=document.createElement('div');image.appendChild(imageHost);image.appendChild(galleryHost);
const imagePrompt=input('Short, neutral image prompt');imagePrompt.value='A simple blue cube on white background';image.appendChild(imagePrompt);
const imageBackend:NativeImageBackend={generateData:async opts=>await root.generateImage(opts) as {dataUrl?:unknown;canvas?:unknown;inputs?:unknown},createTile:opts=>root.generateImage(opts)};
const img=bindImage(imageBackend);
image.appendChild(button('Generate one image (explicit)',()=>void guarded('image',async()=>{
 const prompt=imagePrompt.value.trim();if(!prompt||prompt.length>250)throw Error('PROMPT_MUST_BE_1_TO_250_CHARS');
 const folder=root.kv['plstage3jobs'];
 if(!folder||typeof (folder as {update?:unknown}).update!=='function')throw Error('JOBS_KV_UNAVAILABLE');
 const jobs=new JobStore(folder as ConstructorParameters<typeof JobStore>[0],'stage3-preview');
 const reservation=await jobs.reserve(prompt,'data',{});
 if(reservation.kind!=='ok')throw Error('IMAGE_RESERVATION_FAILED:'+JSON.stringify(reservation));
 const jobId=reservation.value.jobId;
 log('IMAGE_RESERVED',{jobId});
 const out=await img.generateData({prompt});log('IMAGE_OUTCOME',{kind:out.kind,jobId});
 if(out.kind==='ok'){
  const display=document.createElement('img');display.alt='Result of controlled image generation';display.src=out.value.dataUrl;display.style.maxWidth='100%';imageHost.replaceChildren(display);
  const result=await jobs.complete(jobId,'available');
  if(result.kind!=='ok')throw Error('IMAGE_COMPLETION_COMMIT_FAILED:'+JSON.stringify(result));
  log('IMAGE_JOB_COMMITTED',{jobId,status:'available'});
 }else{
  const result=await jobs.complete(jobId,out.kind==='error'?'failed':'unknown');
  if(result.kind!=='ok')log('IMAGE_JOB_COMMIT_UNCERTAIN',{jobId,kind:result.kind});
 }
})));
let galleryHandle: {disposeHost():void} | null=null;
let stopGalleryObservation: (()=>void) | null=null;
image.appendChild(button('Mount native gallery (read-only)',()=>{
 stopGalleryObservation?.();galleryHandle?.disposeHost();
 const gal=bindGallery({mountGallery:(_host,opts)=>String(root.generateImage({gallery:true,...opts}))});
 const r=gal.mount(galleryHost,{sort:'recent'});
 log('GALLERY_OUTCOME',{kind:r.kind,phase:r.kind==='ok'?'mounted_pending':'failed'});
 if(r.kind==='ok'){
   galleryHandle=r.value;
   stopGalleryObservation=r.value.observeReady(observation=>{
     if(observation.state==='ready')log('GALLERY_READY',{phase:'iframe_observed',src:observation.iframe.getAttribute('src')?.slice(0,160)??''});
     else if(observation.state==='unknown')log('GALLERY_UNKNOWN',{reason:observation.reason});
     else if(observation.state==='disposed')log('GALLERY_DISPOSED');
     else log('GALLERY_PENDING');
   },90000);
 }else{galleryHandle=null;stopGalleryObservation=null;}
}));
const recovery=section('Local recovery / evidence');
recovery.appendChild(button('Verify storage backup (no remote calls)',()=>void guarded('backup',async()=>{
 const f=(folder:string)=>root.kv[folder] as ConstructorParameters<typeof DraftStore>[0] extends (name:string)=>infer T ? T: never;
 const ex=await exportLocal(store,['characters','conversations'],'stage3-preview',f,(d)=>defs[d as keyof typeof defs]?.folder??d);if(ex.kind!=='ok')throw Error(JSON.stringify(ex));
 const v=await verifyBundle(ex.value);if(v.kind!=='ok')throw Error(JSON.stringify(v));log('BACKUP_VERIFIED',{records:v.value.records.length,parts:ex.value.parts.length});
})));
recovery.appendChild(button('Download bounded JSONL diagnostics',()=>{
 const blob=new Blob([events.map(e=>JSON.stringify(e)).join('\n')+'\n'],{type:'application/x-ndjson'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='perchance-stage3-'+id+'.jsonl';a.click();URL.revokeObjectURL(url);
}));
const output=document.createElement('pre');output.id='app-log';output.setAttribute('aria-live','polite');el.appendChild(output);
log('BOOT_READY',{selectedBindings:['kv','text','comments','image','gallery']});
window.__pcBoot?.markReady({buildId:id,rootId:'app-root'});
