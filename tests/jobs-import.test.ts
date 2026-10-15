import {FakeKvFolder} from '../src/core/outcome.js';
import {DraftStore} from '../src/kv/store.js';
import {exportLocal,importLocal} from '../src/kv/portable.js';
type Job={id:string;prompt:string;resultKind:'pending'|'unknown'|'available'|'failed';favorite:boolean;importOrigin?:unknown};
type Coll={id:'local-history';jobs:Job[]};type D={jobs:Coll};
const defs={jobs:{folder:'jobs',schemaMajor:1,validate:(v:unknown):v is Coll=>!!v&&typeof v==='object'&&(v as Coll).id==='local-history'&&Array.isArray((v as Coll).jobs)}};
function world(){const f=new FakeKvFolder();const folder=()=>f;return {f,folder,store:new DraftStore<D>(folder,defs),opts:{targetSlug:'dest',folders:folder,folderOf:()=> 'jobs'}};}
const src=world();await src.store.commit('jobs','local-history',null,{id:'local-history',jobs:[{id:'same',prompt:'FROM_SOURCE',resultKind:'available',favorite:false}]});
const ex=await exportLocal(src.store,['jobs'],'src',src.folder,()=> 'jobs');if(ex.kind!=='ok')throw Error('export failed');
const dest=world();await dest.store.commit('jobs','local-history',null,{id:'local-history',jobs:[{id:'same',prompt:'UNRELATED_DEST',resultKind:'pending',favorite:true}]});
const first=await importLocal(dest.store,ex.value,'merge',dest.opts);
if(first.kind!=='ok'||first.value.state!=='complete'||first.value.mergedJobs!==1)throw Error('singleton merge failed '+JSON.stringify(first));
const read=await dest.store.load('jobs','local-history');if(read.kind!=='ok'||!read.value?.value)throw Error('history missing');
const jobs=read.value.value.jobs;if(jobs.length!==2||jobs[0]?.id!=='same'||jobs[0]?.prompt!=='UNRELATED_DEST'||jobs[1]?.id==='same'||!jobs[1]?.importOrigin)throw Error('collision did not preserve both jobs '+JSON.stringify(jobs));
const replay=await importLocal(dest.store,ex.value,'merge',dest.opts);if(replay.kind!=='ok'||replay.value.state!=='complete'||replay.value.mergedJobs!==0)throw Error('singleton replay not idempotent '+JSON.stringify(replay));
const after=await dest.store.load('jobs','local-history');if(after.kind!=='ok'||after.value?.value?.jobs.length!==2)throw Error('singleton duplicated replay');
// Every slot unresolved or favorited: never silently evict a job to import another.
const full=world();await full.store.commit('jobs','local-history',null,{id:'local-history',jobs:Array.from({length:200},(_,i)=>({id:'id-'+i,prompt:'KEEP',resultKind:'unknown' as const,favorite:false}))});
const blocked=await importLocal(full.store,ex.value,'merge',full.opts);if(blocked.kind!=='ok'||blocked.value.state!=='partial'||!blocked.value.conflicts.includes('jobs/capacity'))throw Error('unresolved jobs evicted '+JSON.stringify(blocked));
const fr=await full.store.load('jobs','local-history');if(fr.kind!=='ok'||fr.value?.value?.jobs.length!==200||fr.value.value.jobs.some(j=>j.prompt==='FROM_SOURCE'))throw Error('full history corrupted');
console.log('PASS singleton job IDs, replay, and unresolved retention');
