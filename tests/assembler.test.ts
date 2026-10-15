import { assemble, validateAssembled } from '../src/assembler/assembler.js';
async function sha(u: Uint8Array): Promise<string> { const d = await crypto.subtle.digest('SHA-256', u as unknown as ArrayBuffer); return [...new Uint8Array(d)].map((b: number)=>b.toString(16).padStart(2,'0')).join(''); }
function shaSync(u: Uint8Array): string { let h=0; for (const b of u) h=(h*31+b)>>>0; return String(h); }
{
  const pkg = await assemble({ generatorSlug:'demo-gen', buildId:'a1b2c3d4', previousBuildId:null, selectedProfiles:['ai.text@1','storage.kv@1'], scriptBody:'console.log(1)', styleBody:'xb{}' });
  if (!pkg.mainPjs.includes('generateText')) throw new Error('pjs');
  if (pkg.files.length!==4) throw new Error('files '+pkg.files.length);
  const jsEntry = pkg.files.find((f: {runtimePath:string})=>f.runtimePath.endsWith('.js'));
  if (!jsEntry || !(jsEntry as {archivePath:string}).archivePath.endsWith('.js.txt')) throw new Error('transfer suffix');
  const syncSha = (u: Uint8Array): string => {
    const m = pkg.files.find((f: {runtimePath:string})=>pkg.fileContents.get(f.runtimePath)===u);
    return m ? (m as {sha256:string}).sha256 : '';
  };
  const issues = validateAssembled(pkg, (u: Uint8Array)=>{
    for (const f of pkg.files) if (pkg.fileContents.get(f.runtimePath)===u) return f.sha256;
    return 'mismatch';
  });
  if (issues.length) throw new Error('validate '+issues.join(','));
  const badManifest = JSON.parse(JSON.stringify(pkg.manifest)) as {files:Array<{bytes:number}>};
  (badManifest.files.find((f: {bytes:number})=>true) as {bytes:number}).bytes = 999;
  const bad = { ...pkg, manifest: badManifest };
  const iss2 = validateAssembled(bad as never, (u: Uint8Array)=>{ for (const f of pkg.files) if (pkg.fileContents.get(f.runtimePath)===u) return f.sha256; return 'x'; });
  if (!iss2.some((s: string)=>s.startsWith('MANIFEST'))) throw new Error('tamper must fail');
}
console.log('PASS assembler');
