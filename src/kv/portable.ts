// Portable exchange v2: immutable origin, full preflight, bounded per-part decoding,
// deterministic dependency plans, CAS-only commits, and crash/replay reconciliation.
import { ok, err, type Outcome } from '../core/outcome.js';
import { canonicalJson, H } from './canonical.js';
import { DraftStore, canonicalKey, ID_RE, type KvFolderLike, type ImportOrigin, type StoredAggregate } from './store.js';

export type PortableRecord = {domain:string;sourceId:string;schemaMajor:number;revision:number;deleted:false;value:unknown;sourceRecordDigest:string};
export type PartDescriptor = {name:string;sha256:string;bytes:number;recordCount:number};
export type ExportIndexV2 = {exportFormatVersion:2;sourceGeneratorSlug:string;exportedAt:string;partDigests:PartDescriptor[];recordCount:number;omittedCorrupt:Array<{domain:string;id:string;reason:string}>;rootDigest:string};
export type PortableBundle = {index:ExportIndexV2;parts:Array<{name:string;data:string}>};
export type ImportReport = {state:'complete'|'partial';attemptId:string;inserted:number;mergedJobs:number;resumed:number;resumedModified:number;remapped:number;skippedExisting:number;remaining:number;conflicts:string[]};
export type MigrationReport = {state:'complete'|'partial';migrated:number;alreadyCurrent:number;tombstonesPreserved:number;conflicts:string[]};
export type VerifiedRecord = Omit<PortableRecord,'value'> & {characterId?:string;characterIncarnationId?:string;characterSnapshot?:{name:string;systemPrompt:string};incarnationId?:string};
const MAX_PART_BYTES=4*1024*1024, MAX_TOTAL_BYTES=240*1024*1024, MAX_PARTS=64, MAX_RECORDS=100000;
function bytes(s:string):number{return new TextEncoder().encode(s).byteLength;}
export async function shaHex(s:string|Uint8Array):Promise<string>{const data=typeof s==='string'?new TextEncoder().encode(s):s;const d=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');}
export async function sourceRecordDigest(rec:{schemaMajor:number;revision:number;deleted:boolean;value:unknown}):Promise<string>{return H('portable-record-v1',canonicalJson({schemaMajor:rec.schemaMajor,revision:rec.revision,deleted:rec.deleted,value:rec.value}));}
export async function fileDigestOfIndex(index:Omit<ExportIndexV2,'rootDigest'>):Promise<string>{return H('bundle-index-v1',canonicalJson(index));}
function cleanRecord(x:unknown): x is PortableRecord {
 if(!x||typeof x!=='object')return false;const r=x as Record<string,unknown>;
 return typeof r['domain']==='string'&&/^[a-z][a-z0-9_-]{0,48}$/.test(r['domain'])&&typeof r['sourceId']==='string'&&ID_RE.test(r['sourceId'])&&Number.isSafeInteger(r['schemaMajor'])&&(r['schemaMajor'] as number)>=1&&Number.isSafeInteger(r['revision'])&&(r['revision'] as number)>=1&&r['deleted']===false&&typeof r['sourceRecordDigest']==='string'&&/^[a-f0-9]{64}$/.test(r['sourceRecordDigest'])&&r['value']!==undefined;
}
function fromValue(r:PortableRecord):VerifiedRecord {
 const v = r.value&&typeof r.value==='object'?r.value as Record<string,unknown>:{};
 const m:VerifiedRecord={domain:r.domain,sourceId:r.sourceId,schemaMajor:r.schemaMajor,revision:r.revision,deleted:false,sourceRecordDigest:r.sourceRecordDigest};
 if(typeof v['characterId']==='string')m.characterId=v['characterId'];
 if(typeof v['characterIncarnationId']==='string')m.characterIncarnationId=v['characterIncarnationId'];
 if(typeof v['incarnationId']==='string')m.incarnationId=v['incarnationId'];
 if(v['characterSnapshot']&&typeof v['characterSnapshot']==='object'){
  const snap=v['characterSnapshot'] as Record<string,unknown>;
  if(typeof snap['name']==='string'&&typeof snap['systemPrompt']==='string')m.characterSnapshot={name:snap['name'],systemPrompt:snap['systemPrompt']};
 }
 return m;
}
function byKey(a:VerifiedRecord,b:VerifiedRecord):number{return a.domain.localeCompare(b.domain)||a.sourceId.localeCompare(b.sourceId);}
export async function exportLocal<D extends Record<string,unknown>>(store:DraftStore<D>,domains:Array<keyof D & string>,slug:string,folders:(folder:string)=>KvFolderLike,folderOf:(domain:string)=>string):Promise<Outcome<PortableBundle>>{
 void store;
 const omitted:ExportIndexV2['omittedCorrupt']=[],parts:PortableBundle['parts']=[],descs:PartDescriptor[]=[];
 const sortedDomains=[...new Set(domains.map(String))].sort((a,b)=>{const order=['characters','conversations','settings','presets','jobs'];return (order.indexOf(a)<0?100:order.indexOf(a))-(order.indexOf(b)<0?100:order.indexOf(b))||a.localeCompare(b);});
 let current:string[]=[],used=2,totalRecords=0,totalBytes=0;
 async function flush():Promise<void>{if(!current.length)return;const name=`part-${String(parts.length+1).padStart(3,'0')}.json`;const data='['+current.join(',')+']';const size=bytes(data);if(size>MAX_PART_BYTES||parts.length>=MAX_PARTS||totalBytes+size>MAX_TOTAL_BYTES)throw Error('EXPORT_CAPACITY');parts.push({name,data});descs.push({name,sha256:await shaHex(data),bytes:size,recordCount:current.length});totalBytes+=size;current=[];used=2;}
 try {
 for(const domain of sortedDomains){const folder=folders(folderOf(domain));const keys=(await folder.keys()).filter(k=>k.startsWith('r/')).sort();
  for(const key of keys){const id=key.slice(2);let raw:unknown;try{raw=await folder.get(key);}catch{omitted.push({domain,id,reason:'unreadable'});continue;}
   if(raw===undefined)continue;
   if(!raw||typeof raw!=='object'){omitted.push({domain,id,reason:'envelope'});continue;}
   const a=raw as Partial<StoredAggregate<unknown>>;
   if(a.deleted===true)continue;
   if(!Number.isSafeInteger(a.schemaMajor)||!Number.isSafeInteger(a.revision)||a.value===undefined){omitted.push({domain,id,reason:'envelope'});continue;}
   let item:string;
   try{const digest=await sourceRecordDigest({schemaMajor:a.schemaMajor!,revision:a.revision!,deleted:false,value:a.value});item=JSON.stringify({domain,sourceId:id,schemaMajor:a.schemaMajor,revision:a.revision,deleted:false,value:a.value,sourceRecordDigest:digest});if(!item)throw Error('empty');}
   catch{omitted.push({domain,id,reason:'unreadable'});continue;}
   const size=bytes(item),add=size+(current.length?1:0);
   if(size+2>MAX_PART_BYTES) return err('EXPORT_NON_SNAPSHOT','record exceeds part cap');
   if(used+add>MAX_PART_BYTES)await flush();current.push(item);used+=size+(current.length>1?1:0);totalRecords++;
  }
 }
 await flush();
 const indexNoRoot={exportFormatVersion:2 as const,sourceGeneratorSlug:slug,exportedAt:new Date().toISOString(),partDigests:descs,recordCount:totalRecords,omittedCorrupt:omitted};
 const rootDigest=await H('bundle-root-v1',canonicalJson(indexNoRoot));
 return ok({index:{...indexNoRoot,rootDigest},parts});
 }catch{return err('EXPORT_NON_SNAPSHOT','export unavailable or over capacity');}
}
export function applicationOrder(parts:Array<Array<{domain:string;id:string}>>):Array<[string,string]>{const order=['characters','conversations','settings','presets','jobs'];const all=parts.flat();return all.sort((a,b)=>{const ia=order.indexOf(a.domain),ib=order.indexOf(b.domain);return (ia<0?100:ia)-(ib<0?100:ib)||a.domain.localeCompare(b.domain)||a.id.localeCompare(b.id);}).map(x=>[x.domain,x.id]);}
// Each part is decoded in a scoped iteration. The result is compact metadata,
// not the decoded record payloads; callers re-read verified parts for writes.
export async function verifyBundle(bundle:PortableBundle):Promise<Outcome<{records:VerifiedRecord[]}>>{
 const index=bundle?.index;
 if(!index||index.exportFormatVersion!==2||!Array.isArray(index.partDigests)||!Array.isArray(bundle.parts)||!Array.isArray(index.omittedCorrupt))return err('IMPORT_INVALID','framing');
 if(index.partDigests.length>MAX_PARTS||index.recordCount>MAX_RECORDS||index.recordCount<0)return err('IMPORT_CAPACITY','count');
 const sorted=[...index.partDigests].sort((a,b)=>a.name.localeCompare(b.name));
 if(JSON.stringify(sorted)!==JSON.stringify(index.partDigests))return err('IMPORT_INVALID','noncanonical descriptor order');
 const map=new Map(bundle.parts.map(p=>[p.name,p]));if(map.size!==sorted.length||bundle.parts.length!==sorted.length)return err('IMPORT_INVALID','part set');
 const records:VerifiedRecord[]=[],seen=new Set<string>();let totalBytes=0;
 for(const d of sorted){
  if(!/^part-\d{3}\.json$/.test(d.name)||!Number.isSafeInteger(d.recordCount)||!Number.isSafeInteger(d.bytes)||d.bytes>MAX_PART_BYTES||d.bytes<2)return err('IMPORT_INVALID','part metadata');
  const p=map.get(d.name);if(!p||typeof p.data!=='string')return err('IMPORT_INVALID','missing part');
  if(bytes(p.data)!==d.bytes||await shaHex(p.data)!==d.sha256)return err('IMPORT_INVALID','part checksum');
  totalBytes+=d.bytes;if(totalBytes>MAX_TOTAL_BYTES)return err('IMPORT_CAPACITY','archive bytes');
  let arr:unknown;try{arr=JSON.parse(p.data);}catch{return err('IMPORT_INVALID','JSON');}
  if(!Array.isArray(arr)||arr.length!==d.recordCount)return err('IMPORT_INVALID','part count');
  for(const r of arr){if(!cleanRecord(r))return err('IMPORT_INVALID','invalid record');const key=r.domain+'/'+r.sourceId;if(seen.has(key))return err('IMPORT_INVALID','duplicate source');seen.add(key);
   try{if(await sourceRecordDigest(r)!==r.sourceRecordDigest)return err('IMPORT_INVALID','record checksum');}catch{return err('IMPORT_INVALID','noncanonical record');}
   records.push(fromValue(r));if(records.length>MAX_RECORDS)return err('IMPORT_CAPACITY','records');
  }
 }
 if(records.length!==index.recordCount)return err('IMPORT_INVALID','total count');
 const rest={exportFormatVersion:index.exportFormatVersion,sourceGeneratorSlug:index.sourceGeneratorSlug,exportedAt:index.exportedAt,partDigests:index.partDigests,recordCount:index.recordCount,omittedCorrupt:index.omittedCorrupt};
 try{if(await H('bundle-root-v1',canonicalJson(rest))!==index.rootDigest)return err('IMPORT_INVALID','root checksum');}catch{return err('IMPORT_INVALID','root serialization');}
 return ok({records});
}
function sameOrigin(a:unknown, attemptId:string, m:VerifiedRecord):boolean{
 if(!a||typeof a!=='object')return false;const x=a as {origin?:ImportOrigin,deleted?:boolean};const o=x.origin;
 return x.deleted!==true&&!!o&&o.attemptId===attemptId&&o.sourceDomain===m.domain&&o.sourceId===m.sourceId&&o.sourceRecordDigest===m.sourceRecordDigest;
}
function readOriginMatch(a:unknown,attemptId:string,m:VerifiedRecord):'same'|'modified'|null{
 if(!a||typeof a!=='object'||(a as {deleted?:boolean}).deleted===true)return null;
 const o=(a as {origin?:ImportOrigin}).origin;
 if(!o||o.attemptId!==attemptId||o.sourceDomain!==m.domain||o.sourceId!==m.sourceId)return null;
 return o.sourceRecordDigest===m.sourceRecordDigest && (a as {revision?:number}).revision===1?'same':'modified';
}
async function mappedId(digest:string,domain:string,id:string,used:Set<string>):Promise<string>{const base='imp-'+(await H('import-id-v1',digest,domain,id)).slice(0,32);if(!used.has(domain+'/'+base))return base;for(let i=1;i<1000;i++){const x=base+'-c'+i;if(!used.has(domain+'/'+x))return x;}throw Error('IMPORT_CAPACITY:IDs');}
function reorderDomains(domains:string[]):string[]{const order=['characters','conversations','settings','presets','jobs'];return [...domains].sort((a,b)=>{const x=order.indexOf(a),y=order.indexOf(b);return (x<0?100:x)-(y<0?100:y)||a.localeCompare(b);});}
export async function importLocal<D extends Record<string,unknown>>(store:DraftStore<D>,bundle:PortableBundle,mode:'merge',opts:{targetSlug:string;folders:(f:string)=>KvFolderLike;folderOf:(d:string)=>string;converters?:Record<string,(old:unknown)=>unknown>}):Promise<Outcome<ImportReport>>{
 void store;
 if(mode!=='merge')return err('IMPORT_INVALID','merge only');
 const v=await verifyBundle(bundle);if(v.kind!=='ok')return v as Outcome<ImportReport>;
 const metadata=v.value.records;
 // Preflight the entire archive against the active domain registry and converters.
 // No destination mutation is permitted before all records pass this check.
 const domainDefs=new Map<string,ReturnType<typeof store.domainDefinition<keyof D & string>>>();
 for(const m of metadata){
  let def:ReturnType<typeof store.domainDefinition<keyof D & string>>;
  try{def=store.domainDefinition(m.domain as keyof D & string);}catch{return err('IMPORT_INVALID','unregistered domain '+m.domain);}
  if(m.schemaMajor>def.schemaMajor)return err('SCHEMA_TOO_NEW','future imported major');
  if(m.schemaMajor<def.schemaMajor&&!opts.converters?.[m.domain])return err('SCHEMA_MIGRATION_REQUIRED','missing import converter');
  domainDefs.set(m.domain,def);
 }
 for(const desc of bundle.index.partDigests){
  const part=bundle.parts.find(x=>x.name===desc.name)!;
  const arr=JSON.parse(part.data) as PortableRecord[];
  for(const rec of arr){
   const def=domainDefs.get(rec.domain)!;
   if(rec.domain==='jobs'&&rec.sourceId==='local-history'){
    const j=(rec.value as {jobs?:unknown})?.jobs;
    if(!Array.isArray(j)||j.length>200||j.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||!ID_RE.test(x.id))||new Set(j.map(x=>x.id)).size!==j.length)
      return err('IMPORT_INVALID','malformed or duplicate image-history jobs');
   }
   let value:unknown=rec.value;
   try{if(rec.schemaMajor<def.schemaMajor)value=opts.converters![rec.domain]!(structuredClone(value));
     if(!def.validate(value))return err('IMPORT_INVALID','invalid domain value '+rec.domain+'/'+rec.sourceId);
   }catch{return err('IMPORT_INVALID','conversion or validation failed');}
  }
 }
 const rest={exportFormatVersion:bundle.index.exportFormatVersion,sourceGeneratorSlug:bundle.index.sourceGeneratorSlug,exportedAt:bundle.index.exportedAt,partDigests:bundle.index.partDigests,recordCount:bundle.index.recordCount,omittedCorrupt:bundle.index.omittedCorrupt};
 const fileDigest=await fileDigestOfIndex(rest),attemptId=await H('import-attempt-v1',fileDigest,opts.targetSlug);
 const domains=reorderDomains([...new Set(metadata.map(m=>m.domain))]);
 const dest=new Map<string,Map<string,unknown>>();const used=new Set<string>();
 try{for(const domain of domains){const folder=opts.folders(opts.folderOf(domain));const items=new Map<string,unknown>();for(const key of (await folder.keys()).filter(k=>k.startsWith('r/'))){const id=key.slice(2);items.set(id,await folder.get(key));used.add(domain+'/'+id);}dest.set(domain,items);}}catch{return err('STORE_UNAVAILABLE','import preflight destination');}
 // Reject ambiguous provenance before writing even a single key.
 const plan=new Map<string,{targetId:string;action:'resume'|'resume-modified'|'insert'|'merge-jobs';remap:boolean}>();
 for(const m of metadata){const items=dest.get(m.domain)!;const matches=[...items].filter(([,r])=>readOriginMatch(r,attemptId,m)!==null);
  if(matches.length>1)return err('IMPORT_INVALID','ambiguous origin');
  const key=m.domain+'/'+m.sourceId;
  if(m.domain==='jobs'&&m.sourceId==='local-history'){plan.set(key,{targetId:'local-history',action:'merge-jobs',remap:false});continue;}
  if(matches.length){const [id,raw]=matches[0]!;plan.set(key,{targetId:id,action:readOriginMatch(raw,attemptId,m)==='same'?'resume':'resume-modified',remap:id!==m.sourceId});continue;}
  let targetId=m.sourceId,remap=false;
  if(used.has(key)){try{targetId=await mappedId(fileDigest,m.domain,m.sourceId,used);}catch{return err('IMPORT_CAPACITY','identity space');}remap=true;}
  used.add(m.domain+'/'+targetId);plan.set(key,{targetId,action:'insert',remap});
 }
 const conflicts:string[]=[];let inserted=0,resumed=0,resumedModified=0,remapped=0,mergedJobs=0,skippedExisting=0;
 // Process character records first even when archive parts place them last;
 // parse only one bounded part per domain pass.
 for(const domain of domains){for(const desc of bundle.index.partDigests){const p=bundle.parts.find(x=>x.name===desc.name)!;
  if(bytes(p.data)!==desc.bytes||await shaHex(p.data)!==desc.sha256){conflicts.push('part-mutated:'+desc.name);break;}
  const arr=JSON.parse(p.data) as PortableRecord[];
  for(const rec of arr){if(rec.domain!==domain)continue;
   const m=metadata.find(x=>x.domain===domain&&x.sourceId===rec.sourceId)!;
   const action=plan.get(domain+'/'+rec.sourceId)!;
   if(action.action==='resume'){resumed++;continue;}if(action.action==='resume-modified'){resumedModified++;continue;}
   const folder=opts.folders(opts.folderOf(domain));
   if(action.action==='merge-jobs'){
    const jobs=(rec.value as {jobs?:unknown})?.jobs;
    if(!Array.isArray(jobs)||jobs.some(j=>!j||typeof j!=='object'||!ID_RE.test(String((j as {id?:unknown}).id??'')))){conflicts.push('jobs/invalid');continue;}
    const sourceIds=jobs.map(j=>String((j as {id:string}).id));
    if(new Set(sourceIds).size!==sourceIds.length){conflicts.push('jobs/duplicate-source-id');continue;}
    // Precompute hashes OUTSIDE the synchronous native update callback.
    const candidates=new Map<string,string>();
    for(const jobId of sourceIds)candidates.set(jobId,'imp-'+(await H('import-job-id-v1',fileDigest,jobId)).slice(0,32));
    let successful=false;
    for(let retry=0;retry<3&&!successful;retry++){
      let raw:unknown;
      try{raw=await folder.get(canonicalKey('local-history'));}catch{break;}
      const base=raw&&typeof raw==='object'?raw as StoredAggregate<unknown>:undefined;
      if(base&&(base.deleted||base.schemaMajor!==1)){conflicts.push('jobs/incompatible');break;}
      const prior=base?.value as {id?:unknown;jobs?:unknown}|undefined;
      if(base&&(!prior||prior.id!=='local-history'||!Array.isArray(prior.jobs))){conflicts.push('jobs/corrupt');break;}
      const current=structuredClone((prior?.jobs??[]) as Array<{id:string;favorite?:boolean;resultKind?:string;importOrigin?:{attemptId:string;sourceJobId:string;fileDigest:string}}>);
      const result=[...current];const takenJobs=new Set(result.map(j=>j.id));let added=0;let resumedJobs=0;
      for(const job of jobs as Array<{id:string;[key:string]:unknown}>){
        if(result.some(j=>j.importOrigin?.attemptId===attemptId&&j.importOrigin.sourceJobId===job.id&&j.importOrigin.fileDigest===fileDigest)){resumedJobs++;continue;}
        let target=job.id;
        if(takenJobs.has(target)){
          const start=candidates.get(job.id)!;target=start;
          for(let n=1;takenJobs.has(target)&&n<=1000;n++)target=start+'-c'+n;
          if(takenJobs.has(target)){conflicts.push('jobs/remap-exhausted');break;}
        }
        if(result.length>=200){const evict=result.findIndex(j=>!j.favorite&&(j.resultKind==='available'||j.resultKind==='failed'));
          if(evict<0){conflicts.push('jobs/capacity');break;}
          takenJobs.delete(result[evict]!.id);result.splice(evict,1);
        }
        result.push({...structuredClone(job),id:target,importOrigin:{attemptId,fileDigest,sourceJobId:job.id}});
        takenJobs.add(target);added++;
      }
      if(conflicts.some(x=>x.startsWith('jobs/')))break;
      if(!added){resumed+=resumedJobs;successful=true;break;}
      const prevRevision=base?.revision??0;
      try{await folder.update(canonicalKey('local-history'),(before)=>{
        const a=before&&typeof before==='object'?before as StoredAggregate<unknown>:undefined;
        if((a?.revision??0)!==prevRevision||(a?.deleted??false))throw Error('REVISION_CONFLICT');
        return {schemaMajor:1,revision:prevRevision+1,deleted:false,value:{id:'local-history',jobs:structuredClone(result)},...(a?.origin?{origin:a.origin}:{})};
      });mergedJobs+=added;resumed+=resumedJobs;successful=true;}
      catch{ /* Reread and rebase on a concurrent favorite or completion */ }
    }
    if(!successful&&!conflicts.some(x=>x.startsWith('jobs/')))conflicts.push('jobs/merge-cas');
    continue;
   }
   let value:unknown;try{
    value=structuredClone(rec.value);
    if(rec.schemaMajor<domainDefs.get(domain)!.schemaMajor)value=structuredClone(opts.converters![domain]!(value));
   }catch{conflicts.push(domain+'/'+rec.sourceId+':clone-or-conversion');continue;}
   if(domain==='conversations'&&value&&typeof value==='object'){
    const conv=value as Record<string,unknown>;
    if(typeof conv['characterId']==='string'){
     const charSrc=conv['characterId'],charPlan=plan.get('characters/'+charSrc);
     if(charPlan){
      const character=await opts.folders(opts.folderOf('characters')).get(canonicalKey(charPlan.targetId)).catch(()=>undefined);
      const ca=character as StoredAggregate<{incarnationId?:unknown}>|undefined;
      if(!ca||ca.deleted||ca.value?.incarnationId!==conv['characterIncarnationId']){conflicts.push('conversations/'+rec.sourceId+':dependency');continue;}
      conv['characterId']=charPlan.targetId;conv['characterState']='linked';
     }else{
      const external=await opts.folders(opts.folderOf('characters')).get(canonicalKey(charSrc)).catch(()=>undefined) as StoredAggregate<{incarnationId?:unknown}>|undefined;
      if(!external||external.deleted||external.value?.incarnationId!==conv['characterIncarnationId']){if(!conv['characterSnapshot']){conflicts.push('conversations/'+rec.sourceId+':snapshot');continue;}conv['characterState']='detached';}
     }
    }
   }
   const origin:ImportOrigin={attemptId,fileDigest,sourceDomain:domain,sourceId:rec.sourceId,sourceRecordDigest:rec.sourceRecordDigest};
   try{await folder.update(canonicalKey(action.targetId),(before)=>{if(before!==undefined)throw Error('REVISION_CONFLICT');return {schemaMajor:domainDefs.get(domain)!.schemaMajor,revision:1,deleted:false,value:structuredClone(value),origin};});inserted++;if(action.remap)remapped++;}
   catch{const current=await folder.get(canonicalKey(action.targetId)).catch(()=>undefined);if(sameOrigin(current,attemptId,m))resumed++;else conflicts.push(domain+'/'+rec.sourceId+':insert-race');}
  }
 }}
 return ok({state:conflicts.length?'partial':'complete',attemptId,inserted,mergedJobs,resumed,resumedModified,remapped,skippedExisting,remaining:conflicts.length,conflicts:conflicts.slice(0,100)});
}
export async function migrateDomain<D extends Record<string,unknown>>(store:DraftStore<D>,domain:keyof D & string,opts:{backup:PortableBundle;acknowledgedByUser:true;folders:(f:string)=>KvFolderLike;folderOf:(d:string)=>string;converters:Record<string,(v:unknown)=>unknown>}):Promise<Outcome<MigrationReport>>{
 if(opts.acknowledgedByUser!==true)return err('MIGRATION_BACKUP_REQUIRED','confirmation');
 const v=await verifyBundle(opts.backup);if(v.kind!=='ok')return v as Outcome<MigrationReport>;
 if(opts.backup.index.omittedCorrupt.some(x=>x.domain===domain))return err('MIGRATION_BACKUP_REQUIRED','corrupt backup gap');
 const backed=new Map(v.value.records.filter(x=>x.domain===domain).map(x=>[x.sourceId,x]));
 const current=store.domainDefinition(domain).schemaMajor;
 const folder=opts.folders(opts.folderOf(domain));let keys:string[];try{keys=(await folder.keys()).filter(x=>x.startsWith('r/')).sort();}catch{return err('STORE_UNAVAILABLE','enumeration');}
 let migrated=0,alreadyCurrent=0,tombstonesPreserved=0;const conflicts:string[]=[];
 for(const key of keys){const id=key.slice(2);const raw=await folder.get(key).catch(()=>undefined);
  if(!raw||typeof raw!=='object'){conflicts.push(id+':invalid');continue;}
  const a=raw as StoredAggregate<unknown>;if(a.deleted===true){tombstonesPreserved++;continue;}
  if(a.schemaMajor===current){alreadyCurrent++;continue;}if(a.schemaMajor>current){conflicts.push(id+':too-new');continue;}
  const b=backed.get(id);if(!b||b.schemaMajor!==a.schemaMajor||b.revision!==a.revision){conflicts.push(id+':backup-revision');continue;}
  if(await sourceRecordDigest(a)!==b.sourceRecordDigest){conflicts.push(id+':backup-digest');continue;}
  const converter=opts.converters[String(domain)];if(!converter){conflicts.push(id+':converter');continue;}
  let converted:unknown;try{converted=structuredClone(converter(structuredClone(a.value)));if(!store.domainDefinition(domain).validate(converted))throw Error('shape');}catch{conflicts.push(id+':invalid-conversion');continue;}
  const snapshot=canonicalJson(a);
  try{await folder.update(key,(before)=>{if(before===undefined||canonicalJson(before)!==snapshot)throw Error('MIGRATION_CONFLICT');return {schemaMajor:current,revision:a.revision+1,deleted:false,value:structuredClone(converted),...(a.origin?{origin:a.origin}:{})};});migrated++;}catch{conflicts.push(id+':cas');}
 }
 return ok({state:conflicts.length?'partial':'complete',migrated,alreadyCurrent,tombstonesPreserved,conflicts:conflicts.slice(0,100)});
}
