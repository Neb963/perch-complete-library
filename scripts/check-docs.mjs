import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let count=0;const docs=['README.md'];
function visit(dir){for(const d of readdirSync(dir,{withFileTypes:true})){const name=join(dir,d.name);if(d.isDirectory())visit(name);else if(d.name.endsWith('.md'))docs.push(name.slice(root.length+1));}}
visit(join(root,'docs'));
for(const p of docs){const full=join(root,p);const body=readFileSync(full,'utf8');assert(body.trim().length>120,'Insufficient documentation '+p);for(const m of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){const target=m[1].split('#')[0];if(!target||/^(https?:|mailto:)/.test(target))continue;assert(existsSync(resolve(dirname(full),decodeURIComponent(target))),'Broken link '+p+' => '+target);count++;}}
for(const n of ['core','storage','text','image','gallery','comments','chat','host','build']){const doc='docs/api/'+n+'.md';assert(docs.includes(doc),'Missing API reference: '+n);const s=readFileSync(join(root,doc),'utf8');assert(s.toLowerCase().includes('# '+n),'Reference lacks section '+n);}
const readme=readFileSync(join(root,'README.md'),'utf8');assert(!readme.includes('npm install perch-complete-library') || readme.includes('not yet published'));
console.log('PASS docs: '+docs.length+' documents, '+count+' relative links, nine API entries');
