import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'pcl-consumer-'));
function run(bin,args,cwd=temp){const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:120000});assert.equal(r.status,0,`${bin} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);return r}
try{
 const tgz=run('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],root);
 const tarball=JSON.parse(tgz.stdout)[0].filename;
 run('tar',['-xzf',join(temp,tarball)],temp);
 mkdirSync(join(temp,'node_modules'));
 symlinkSync(join(temp,'package'),join(temp,'node_modules','perch-complete-library'),'dir');
 writeFileSync(join(temp,'package.json'),JSON.stringify({private:true,type:'module'}));
 writeFileSync(join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,types:[],lib:['ES2022','DOM'],outDir:'out'},files:['consumer.ts']}));
 writeFileSync(join(temp,'consumer.ts'), `import {DraftStore, type KvFolderLike, type DomainDef} from 'perch-complete-library/storage';
import {ok, type Outcome} from 'perch-complete-library/core';
import {bindText} from 'perch-complete-library/text';
import {bindImage} from 'perch-complete-library/image';
import {bindGallery} from 'perch-complete-library/gallery';
import {createRoomBinder} from 'perch-complete-library/comments';
import {newConversation} from 'perch-complete-library/chat';
import {bindHostEnvironment} from 'perch-complete-library/host';
import {composeImports} from 'perch-complete-library/build';
import assert from 'node:assert/strict'; // explicitly exercised runtime, no Node typings needed? 
const m=new Map<string,unknown>();
const folder:KvFolderLike={async get(k){return structuredClone(m.get(k));},async set(k,v){m.set(k,structuredClone(v));},async delete(k){m.delete(k);},async keys(){return [...m.keys()]},async update(k,fn){const n=fn(structuredClone(m.get(k)));m.set(k,structuredClone(n));}};
type Domains={settings:{title:string}};
const definition:DomainDef<Domains['settings']>={folder:'settings',schemaMajor:1,validate:(x):x is Domains['settings']=>typeof x==='object'&&x!==null&&typeof (x as {title?:unknown}).title==='string'};
const store=new DraftStore<Domains>(()=>folder,{settings:definition});
const created=await store.commit('settings','sample',null,{title:'ready'});
if(created.kind!=='ok')throw Error('create failed:'+created.kind);
const loaded=await store.load('settings','sample');
if(loaded.kind!=='ok'||loaded.value?.value?.title!=='ready')throw Error('store reload failed');
if(composeImports([]).issues.length)throw Error('invalid empty imports');
if(bindText(null).kind!=='unavailable'){} // binder does not itself use Outcome here; runtime exercised
void bindImage;void bindGallery;void createRoomBinder;void newConversation;void bindHostEnvironment;void ok;
console.log('PASS external consumer ESM and types');` .replace("import assert from 'node:assert/strict'; // explicitly exercised runtime, no Node typings needed? ",""));
 // Avoid encoding assumptions about bindText API return kind, explicit binding is still exercised.
 const p=join(temp,'consumer.ts');let content=(await import('node:fs')).readFileSync(p,'utf8');content=content.replace("if(bindText(null).kind!=='unavailable'){} // binder does not itself use Outcome here; runtime exercised",'void bindText(null);');writeFileSync(p,content);
 run('tsc',['-p','tsconfig.json']);
 const smoke=run(process.execPath,['out/consumer.js']);
 assert(smoke.stdout.includes('PASS external consumer'));
 console.log('PASS clean packed external consumer: ESM + declarations + CAS-backed reload');
}finally{rmSync(temp,{recursive:true,force:true});}
