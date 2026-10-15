import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const names=['core','storage','text','image','gallery','comments','chat','host','build'];
assert.equal(pkg.name,'perch-complete-library');
assert.equal(pkg.type,'module');
assert.equal(pkg.main,undefined);
assert.equal(pkg.dependencies,undefined,'No runtime dependencies expected');
assert.deepEqual(Object.keys(pkg.exports).sort(),[...names.map(x=>'./'+x),'./package.json'].sort());
const files=[];
function walk(dir){for(const x of readdirSync(dir,{withFileTypes:true})){const p=join(dir,x.name);if(x.isDirectory())walk(p);else files.push(p)}}
walk(join(root,'dist/library'));
assert(files.length>20,'Empty build');
assert(!files.some(x=>/[/\\](browser|ui|safety|files|composition|regression)[/\\]/.test(x)),'Non-library module leaked into distribution');
for(const n of names){
 const e=pkg.exports['./'+n];assert.deepEqual(Object.keys(e).sort(),['import','types']);
 for(const path of Object.values(e))assert(existsSync(join(root,path)),'missing export '+path);
 const imported=await import(pkg.name+'/'+n);
 assert(imported&&typeof imported==='object','module not importable '+n);
}
try{await import(pkg.name);throw new Error('Private root unexpectedly exposed')}catch(e){if(e.message==='Private root unexpectedly exposed')throw e;assert.equal(e.code,'ERR_PACKAGE_PATH_NOT_EXPORTED')}
try{await import(pkg.name+'/src/kv/store.js');throw new Error('Private subpath unexpectedly exposed')}catch(e){if(e.message==='Private subpath unexpectedly exposed')throw e;assert.equal(e.code,'ERR_PACKAGE_PATH_NOT_EXPORTED')}
const packed=spawnSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:root,encoding:'utf8',timeout:60000});
assert.equal(packed.status,0,'npm pack dry-run: '+packed.stderr);
const entry=JSON.parse(packed.stdout)[0];assert(entry?.files?.length>10,'Empty npm tarball');
const paths=entry.files.map(x=>x.path);
assert(paths.some(x=>x.endsWith('.d.ts')),'No declarations in pack');
assert(paths.some(x=>x.endsWith('.js')),'No ESM in pack');
assert(!paths.some(x=>x.includes('node_modules/')||x.includes('/tests/')||x.includes('/browser/')||x.includes('/ui/')||x.startsWith('src/')||x.startsWith('provenance/')||x.startsWith('evidence/')||x.startsWith('scripts/')),'Unexpected private content shipped');
for(const x of names)assert(paths.includes('dist/library/public/'+x+'.js') && paths.includes('dist/library/public/'+x+'.d.ts'),'Missing packed public import '+x);
console.log('PASS package: '+names.length+' public import paths, '+files.length+' emitted files, '+paths.length+' packed files; private paths fenced; no runtime deps');
