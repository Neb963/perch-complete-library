// S3-14 selected-profile package assembler + release validator (offline, no saved claim)
import { composePackage } from '../bootstrap/sentinel.js';
import { buildIndexHtml } from '../bootstrap/sentinel.js';
import { lintPjs, lintHtml, lintManifest } from '../bootstrap/linter.js';

export interface AssembleInput {
  generatorSlug: string;
  buildId: string;
  previousBuildId: string | null;
  selectedProfiles: string[];
  scriptBody: string; // already-bundled app JS
  styleBody: string;
}

export interface AssembledPackage {
  mainPjs: string;
  indexHtml: string;
  files: Array<{ runtimePath: string; archivePath: string; bytes: number; sha256: string; kind: string }>;
  manifest: Record<string, unknown>;
  fileContents: Map<string, Uint8Array>;
}

export async function shaHexBytes(u: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', u);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function assemble(input: AssembleInput): Promise<AssembledPackage> {
  const { mainPjs, manifestImports } = composePackage({ buildId: input.buildId, previousBuildId: input.previousBuildId, generatorSlug: input.generatorSlug, selectedProfiles: input.selectedProfiles });
  const modulePath = 'src/app-' + input.buildId + '.js';
  const stylePath = 'src/app-' + input.buildId + '.css';
  const indexHtml = buildIndexHtml({ buildId: input.buildId, modulePath, stylePath }, 'Assembled ' + input.buildId);
  const enc = new TextEncoder();
  const fileContents = new Map<string, Uint8Array>([
    ['main.pjs', enc.encode(mainPjs)],
    ['index.html', enc.encode(indexHtml)],
    [modulePath, enc.encode(input.scriptBody)],
    [stylePath, enc.encode(input.styleBody)],
  ]);
  // archive transfer: JS uses .js.txt outside archive, runtime .js
  const archiveFor = (rt: string): string => rt.endsWith('.js') ? rt + '.txt' : rt;
  const files: AssembledPackage['files'] = [];
  const sortedRuntime = [...fileContents.keys()].sort();
  for (const rt of sortedRuntime) {
    const bytes = fileContents.get(rt);
    if (!bytes) throw new Error('missing content:' + rt);
    files.push({ runtimePath: rt, archivePath: archiveFor(rt), bytes: bytes.length, sha256: await shaHexBytes(bytes), kind: rt.endsWith('.pjs')?'pjs':rt.endsWith('.html')?'html':rt.endsWith('.js')?'js':'css' });
  }
  const manifest = {
    schemaVersion: 4,
    generatorSlug: input.generatorSlug,
    buildId: input.buildId,
    previousBuildId: input.previousBuildId,
    selectedProfiles: input.selectedProfiles.map(id=>({id})),
    imports: manifestImports.map(m=>({alias:m.alias, importName:m.importName, bindingId:m.alias, sideEffects:[]})),
    files,
    entry: { htmlPath:'index.html', pjsPath:'main.pjs', scriptPath:modulePath, stylesheetPath:stylePath, buildInfoId: input.buildId },
    applicationPackages: [],
    storage:{domains:[], exportFormatVersion:2},
    channels:{schemaVersion:1, rooms:[]},
    claims:[],
    release:{target:'preview', minimumClaims:[], compatiblePreviousBuildIds: input.previousBuildId?[input.previousBuildId]:[], requiresInterruption:false, assumptions:['preview only, no saved-public claim'], previousBackupSha256:null},
  };
  return { mainPjs, indexHtml, files, manifest, fileContents };
}

export function validateAssembled(pkg: AssembledPackage, shaOf:(u:Uint8Array)=>string): string[] {
  const issues: string[] = [];
  const p = lintPjs(pkg.mainPjs);
  for (const i of p.issues) issues.push('PJS:'+i.code);
  const h = lintHtml(pkg.indexHtml);
  for (const i of h.issues) {
    if (i.code==='OWNED_BOOT_ASSET_MISMATCH') continue; // checked via manifest below with exact paths
    issues.push('HTML:'+i.code);
  }
  // manifest check: need fileBytes map by archivePath
  const map = new Map<string,Uint8Array>();
  for (const f of pkg.files) {
    const rt = f.runtimePath;
    const content = pkg.fileContents.get(rt);
    if (!content) { issues.push('MISSING:'+rt); continue; }
    map.set(f.archivePath, content);
  }
  // adapt to lintManifest expected shape (FileEntry with runtimePath/archivePath)
  const m = pkg.manifest as unknown as Parameters<typeof lintManifest>[0];
  const mi = lintManifest(m, map, shaOf);
  for (const i of mi) issues.push('MANIFEST:'+i.code);
  return issues;
}
