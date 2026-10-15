// S3-01 production PJS/HTML/manifest linter — strict v0.3.6 §6.2-6.3
// Runtime-oriented: validates import registry, PJS grammar, $meta, HTML tokens, manifest.

export type LinterIssueCode =
  | 'PJS_UNQUALIFIED' | 'IMPORT_INVALID' | 'IMPORT_MANIFEST_MISMATCH'
  | 'IMPORT_DUPLICATE' | 'IMPORT_UNKNOWN' | 'META_DUPLICATE' | 'META_PLACEMENT'
  | 'META_FIELD' | 'META_VALUE' | 'META_INDENT' | 'META_NUMERIC_TITLE'
  | 'DOM_ID' | 'DOM_ID_RESERVED' | 'HTML_INTERPOLATION' | 'SENTINEL_NOT_FIRST'
  | 'OWNED_BOOT_ASSET_MISMATCH' | 'MANIFEST_VERSION' | 'DUPLICATE_FILES'
  | 'ENTRY_MISSING' | 'ENTRY_BUILDID' | 'BOOT_BUILD_MISMATCH' | 'FILE_ORDER'
  | 'FILE_HASH' | 'MISSING_FILE' | 'PATH_TRAVERSAL' | 'NOT_FLAT_SRC';

export interface LintIssue { code: string; detail?: string }
export interface NativeBinding { bindingId: string; alias: string; importName: string; sideEffects: string[] }

export const ALLOWED_IMPORTS: Readonly<Record<string,string>> = {
  generateText: 'ai-text-plugin',
  generateImage: 'text-to-image-plugin',
  commentsPlugin: 'comments-plugin',
  kv: 'kv-plugin',
  uploadPlugin: 'upload-plugin',
  superFetch: 'super-fetch-plugin',
  secretPlugin: 'secret-plugin',
};

export const PROFILE_BINDINGS: ReadonlyArray<{profile:string; bindingId:string; alias:string; importName:string}> = [
  { profile: 'ai.text@1', bindingId: 'ai.text', alias: 'generateText', importName: 'ai-text-plugin' },
  { profile: 'ai.image@1', bindingId: 'ai.image', alias: 'generateImage', importName: 'text-to-image-plugin' },
  { profile: 'gallery.native@1', bindingId: 'gallery.native', alias: 'generateImage', importName: 'text-to-image-plugin' },
  { profile: 'community.comments@1', bindingId: 'community.comments', alias: 'commentsPlugin', importName: 'comments-plugin' },
  { profile: 'storage.kv@1', bindingId: 'storage.kv', alias: 'kv', importName: 'kv-plugin' },
  { profile: 'files.upload@1', bindingId: 'files.upload', alias: 'uploadPlugin', importName: 'upload-plugin' },
  { profile: 'community.secret@1', bindingId: 'community.secret', alias: 'secretPlugin', importName: 'secret-plugin' },
  { profile: 'network.superfetch@1', bindingId: 'network.superfetch', alias: 'superFetch', importName: 'super-fetch-plugin' },
];

export const RESERVED_IDS = new Set([
  'root','update','createPerchanceTree','generatorName','generatorPublicId',
  'generatorLastEditTime','generatorIsInEditMode','generatorIsUnsaved',
  'ignorePerchanceErrors','clearPerchanceErrors','lastTextToImagePrompt',
  '$meta','$output','$preprocess',
]);

const IMPORT_RE = /^([A-Za-z_$][\w$]*)\s*=\s*\{import:([a-z0-9-]+)\}$/;
const DOM_ID_RE = /^(?:app|pc)-[a-z][a-z0-9-]*$/;
const IMAGE_URL_RE = /^https:\/\/[^\s\/$.?#].[^\s]*$/;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function normalizeLF(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export interface PjsParse { imports: Array<{alias:string; plugin:string; line:number}>; metaPresent: boolean; issues: LintIssue[] }

export function lintPjs(raw: string): PjsParse {
  const issues: LintIssue[] = [];
  const text = normalizeLF(stripBom(raw));
  const lines = text.split('\n');
  const imports: Array<{alias:string; plugin:string; line:number}> = [];
  const seenAlias = new Map<string,number>();
  let metaCount = 0;
  let metaStartLine = -1;
  let inMeta = false;
  let metaIndent: string | null = null;
  let metaFields = new Set<string>();
  let headerSeen = false;
  let inHeader = false;
  let headerIndent: string | null = null;
  let firstImportLine = -1;
  let metaEndLine = -1;

  const metaAllowedTop = new Set(['title','description','tags','image','header']);
  const headerAllowed = new Set(['mode','background']);

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const maybeLine: string | undefined = lines[i];
    if (maybeLine === undefined) continue;
    const rawLine: string = maybeLine;
    if (rawLine.includes('\r')) { issues.push({code:'PJS_UNQUALIFIED', detail:'CR at line '+ln}); }
    const trimmed = rawLine.trim();
    if (trimmed === '') { if (inMeta && rawLine !== '') { /* blank ends? no, allow */ } continue; }
    if (!inMeta && trimmed.startsWith('//')) continue;
    if (trimmed === '$meta') {
      metaCount++;
      if (metaCount > 1) issues.push({code:'META_DUPLICATE', detail:'line '+ln});
      metaStartLine = ln; inMeta = true; inHeader = false;
      metaIndent = null; metaFields = new Set(); headerSeen = false;
      continue;
    }
    if (inMeta) {
      // detect end of meta: non-indented line
      if (!/^\s/.test(rawLine)) {
        inMeta = false; inHeader = false; metaEndLine = ln;
        // fall through to import parsing for this line
      } else {
        const m = /^(\s+)(\S.*)$/.exec(rawLine);
        if (!m) { issues.push({code:'META_VALUE', detail:'line '+ln}); continue; }
        const indent: string | undefined = m[1];
        const rest: string | undefined = m[2];
        if (indent === undefined || rest === undefined) { issues.push({code:'META_VALUE', detail:'line '+ln}); continue; }
        // indent consistency: must be one of 2sp/4sp/1tab/2tabs for top level
        if (metaIndent === null) {
          if (indent !== '  ' && indent !== '    ' && indent !== '\t' && indent !== '\t\t') {
            issues.push({code:'META_INDENT', detail:'line '+ln});
          } else metaIndent = indent;
        }
        // header subsection?
        if (rest === 'header') {
          if (headerSeen) issues.push({code:'META_DUPLICATE', detail:'header line '+ln});
          headerSeen = true; inHeader = true; headerIndent = null;
          if (indent !== metaIndent) issues.push({code:'META_INDENT', detail:'header indent line '+ln});
          continue;
        }
        if (inHeader) {
          // must be deeper than metaIndent
          if (!(indent.length > (metaIndent?.length ?? 0))) {
            // dedent ends header
            inHeader = false;
            // reprocess as top-level meta field
          } else {
            if (headerIndent === null) headerIndent = indent;
            else if (indent !== headerIndent) issues.push({code:'META_INDENT', detail:'header field line '+ln});
            const hm = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(rest);
            if (!hm) { issues.push({code:'META_FIELD', detail:'line '+ln}); continue; }
            const k: string | undefined = hm[1];
            const v: string | undefined = hm[2];
            if (k === undefined || v === undefined) { issues.push({code:'META_FIELD', detail:'line '+ln}); continue; }
            if (!headerAllowed.has(k)) issues.push({code:'META_FIELD', detail:k+' line '+ln});
            else {
              if (k === 'mode' && v.trim() !== 'minimal') issues.push({code:'META_VALUE', detail:'header.mode line '+ln});
              validateMetaValue(k, v, ln, issues);
            }
            continue;
          }
        }
        // top-level meta field (also handles dedented header end)
        if (inHeader && !(rawLine.startsWith((metaIndent ?? '') + ' ') || rawLine.startsWith((metaIndent ?? '') + '\t'))) {
          inHeader = false;
        }
        if (inHeader) { issues.push({code:'META_FIELD', detail:'line '+ln}); continue; }
        if (indent !== metaIndent) { issues.push({code:'META_INDENT', detail:'line '+ln}); continue; }
        const fm = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(rest);
        if (!fm) { issues.push({code:'META_FIELD', detail:'line '+ln}); continue; }
        const k: string | undefined = fm[1];
        const v: string | undefined = fm[2];
        if (k === undefined || v === undefined) { issues.push({code:'META_FIELD', detail:'line '+ln}); continue; }
        if (!metaAllowedTop.has(k)) issues.push({code:'META_FIELD', detail:k+' line '+ln});
        else {
          if (metaFields.has(k)) issues.push({code:'META_DUPLICATE', detail:k+' line '+ln});
          metaFields.add(k);
          validateMetaValue(k, v, ln, issues);
        }
        continue;
      }
    }
    // import line parsing (outside meta)
    if (trimmed.startsWith('//')) { issues.push({code:'PJS_UNQUALIFIED', detail:'comment inside imports line '+ln}); continue; }
    const mm = IMPORT_RE.exec(trimmed);
    if (mm === null) { issues.push({code:'PJS_UNQUALIFIED', detail: trimmed.slice(0,40)+' line '+ln}); continue; }
    const alias: string | undefined = mm[1];
    const plugin: string | undefined = mm[2];
    if (alias === undefined || plugin === undefined) { issues.push({code:'PJS_UNQUALIFIED', detail:'import parse line '+ln}); continue; }
    if (firstImportLine === -1) firstImportLine = ln;
    if (seenAlias.has(alias)) issues.push({code:'IMPORT_DUPLICATE', detail:alias+' line '+ln});
    seenAlias.set(alias, ln);
    const expected = (ALLOWED_IMPORTS as Record<string,string>)[alias];
    if (expected === undefined) issues.push({code:'IMPORT_UNKNOWN', detail:alias+' line '+ln});
    else if (expected !== plugin) issues.push({code:'IMPORT_INVALID', detail:alias+' line '+ln});
    if (plugin === 'server-plugin') issues.push({code:'IMPORT_INVALID', detail:'server not admitted line '+ln});
    imports.push({alias, plugin, line: ln});
  }
  if (metaCount > 0) {
    if (!metaFields.has('title') || !metaFields.has('description')) {
      issues.push({code:'META_VALUE', detail:'title+description required'});
    }
    if (firstImportLine !== -1 && metaStartLine > firstImportLine) {
      issues.push({code:'META_PLACEMENT', detail:'$meta must precede imports'});
    }
  }
  return { imports, metaPresent: metaCount > 0, issues };
}

function validateMetaValue(k: string, v: string, ln: number, issues: LintIssue[]): void {
  if (/[\[\]{}]/.test(v)) { issues.push({code:'META_VALUE', detail:k+' brackets line '+ln}); return; }
  if (/[\u0000-\u001F]/.test(v)) { issues.push({code:'META_VALUE', detail:k+' control line '+ln}); return; }
  if (v.includes('\\')) { issues.push({code:'META_VALUE', detail:k+' backslash line '+ln}); return; }
  if (k === 'title' || k === 'description') {
    const t = v.trim();
    if (t === '' ) { issues.push({code:'META_VALUE', detail:k+' empty line '+ln}); return; }
    if (/^(true|false)$/.test(t) || /^[+-]?(\d+)(\.\d+)?$/.test(t)) {
      issues.push({code:'META_NUMERIC_TITLE', detail:k+' line '+ln}); return;
    }
    if (t.length > 500) issues.push({code:'META_VALUE', detail:k+' too long line '+ln});
  }
  if (k === 'image') {
    const t = v.trim();
    if (!IMAGE_URL_RE.test(t) || !t.startsWith('https://')) { issues.push({code:'META_VALUE', detail:'image URL line '+ln}); return; }
    if (t.includes('//', 8)) {
      // allow only the https:// prefix double-slash; reject // elsewhere? conservative: reject comment-like
      const after = t.slice(8);
      if (after.includes('//')) issues.push({code:'META_VALUE', detail:'image // line '+ln});
    }
  } else {
    if (v.includes('//')) issues.push({code:'META_VALUE', detail:k+' // line '+ln});
  }
  if (v.length > 2000) issues.push({code:'META_VALUE', detail:k+' too long line '+ln});
}

export interface HtmlLint { ids: string[]; issues: LintIssue[]; executable: Array<{kind:string; attrs:Record<string,string>}>; bootAssets: Array<{tag:string; token:string; path:string}> }

export function lintHtml(raw: string): HtmlLint {
  const issues: LintIssue[] = [];
  const ids: string[] = [];
  const executable: Array<{kind:string; attrs:Record<string,string>}> = [];
  const bootAssets: Array<{tag:string; token:string; path:string}> = [];
  // Tokenize tags (simple, handles comments/scripts)
  const tagRe = /<!--[\s\S]*?-->|<script[\s\S]*?<\/script\s*>|<style[\s\S]*?<\/style\s*>|<[^>]+>/gi;
  let inScript = 0, inStyle = 0;
  let firstExec: string | null = null;
  // text-node interpolation: check text between tags when not in script/style
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  // collect script/style bodies for separate checks
  const inlineScripts: string[] = [];
  while ((m = tagRe.exec(raw)) !== null) {
    const token: string = m[0] ?? '';
    const textBetween = raw.slice(lastIdx, m.index);
    if (inScript === 0 && inStyle === 0) {
      if (/\[[^\]]*\]/.test(textBetween) || /\{[^}]*\}/.test(textBetween)) {
        // Only flag if looks like active PJS block: [...] with non-empty or {..import-like..}
        if (/\[[^\[\]]+\]/.test(textBetween)) issues.push({code:'HTML_INTERPOLATION', detail:'template text'});
      }
    }
    lastIdx = m.index + token.length;
    if (token.startsWith('<!--')) continue;
    if (/^<script[\s>]/i.test(token) && !token.includes('</script')) {
      // opening script tag (our regex groups full script blocks, so this branch rarely hit)
    }
    if (/^<script[\s\S]*<\/script\s*>$/i.test(token)) {
      const open = /^<script([^>]*)>/i.exec(token);
      const attrs = parseAttrs(open?.[1] ?? '');
      const kind = attrs['type'] === 'module' ? 'module' : 'classic';
      executable.push({kind, attrs});
      if (firstExec === null) firstExec = kind;
      const body = token.replace(/^<script[^>]*>/i,'').replace(/<\/script\s*>$/i,'');
      inlineScripts.push(body);
      // boot asset?
      if (attrs['data-pc-boot-asset'] !== undefined) {
        bootAssets.push({tag:'script', token: attrs['data-pc-boot-asset'], path: attrs['src'] ?? ''});
      }
      // attribute interpolation check on open tag
      for (const [k,v] of Object.entries(attrs)) {
        if (k.startsWith('on')) continue;
        if (k === 'src' || k === 'href') continue;
        if (v.includes('[') || v.includes('{')) issues.push({code:'HTML_INTERPOLATION', detail:'attribute '+k});
      }
      continue;
    }
    if (/^<style[\s\S]*<\/style\s*>$/i.test(token)) {
      inStyle++; // not needed
      continue;
    }
    // ordinary tag
    const tm = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\s*([^>]*)\/?>$/.exec(token);
    if (!tm) continue;
    const closing = tm[1] ?? "";
    const tag = tm[2]!;
    const attrStr = tm[3] ?? "";
    if (closing) {
      if (tag.toLowerCase() === 'script') inScript = Math.max(0, inScript-1);
      if (tag.toLowerCase() === 'style') inStyle = Math.max(0, inStyle-1);
      continue;
    }
    if (tag.toLowerCase() === 'script') {
      inScript++;
      const attrs = parseAttrs(attrStr);
      // self-contained? actually block handled above; this is lone open (malformed) – still record
      const kind = attrs['type'] === 'module' ? 'module' : 'classic';
      executable.push({kind, attrs});
      if (firstExec === null) firstExec = kind;
      if (attrs['data-pc-boot-asset'] !== undefined) bootAssets.push({tag:'script', token: attrs['data-pc-boot-asset'], path: attrs['src'] ?? ''});
      continue;
    }
    if (tag.toLowerCase() === 'style') { inStyle++; continue; }
    const attrs = parseAttrs(attrStr);
    if (attrs['id'] !== undefined) {
      ids.push(attrs['id']);
      if (!DOM_ID_RE.test(attrs['id'])) issues.push({code:'DOM_ID', detail: attrs['id']});
      if (RESERVED_IDS.has(attrs['id'])) issues.push({code:'DOM_ID_RESERVED', detail: attrs['id']});
    }
    if (tag.toLowerCase() === 'link' && attrs['data-pc-boot-asset'] !== undefined) {
      bootAssets.push({tag:'link', token: attrs['data-pc-boot-asset'], path: attrs['href'] ?? ''});
    }
    for (const [k,v] of Object.entries(attrs)) {
      if (k.startsWith('on')) continue;
      if ((k === 'src' || k === 'href') && (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'link')) continue;
      if (k === 'style') continue;
      if (v.includes('[') || v.includes('{')) issues.push({code:'HTML_INTERPOLATION', detail:'attribute '+k});
    }
  }
  const tail = raw.slice(lastIdx);
  if (/\[[^\[\]]+\]/.test(tail)) issues.push({code:'HTML_INTERPOLATION', detail:'template text'});
  if (executable.length === 0 || executable[0]?.kind !== 'classic') {
    issues.push({code:'SENTINEL_NOT_FIRST'});
  }
  // inline script safety: prohibit PJS interpolation generation, source maps, secrets
  for (const body of inlineScripts) {
    if (body.includes('sourceMappingURL')) issues.push({code:'HTML_INTERPOLATION', detail:'sourcemap'});
    if (/AIza|sk-[A-Za-z0-9]|BEGIN [A-Z ]*PRIVATE KEY/.test(body)) issues.push({code:'HTML_INTERPOLATION', detail:'secret'});
  }
  return { ids, issues, executable, bootAssets };
}

function parseAttrs(s: string): Record<string,string> {
  const out: Record<string,string> = {};
  const re = /([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const k: string | undefined = m[1];
    if (k === undefined) continue;
    const v: string = (m[2] ?? m[3] ?? m[4] ?? '') as string;
    out[k] = v;
  }
  return out;
}

export interface ManifestFile { runtimePath: string; archivePath?: string; sha256: string; bytes: number; kind: string }
export interface GeneratorManifest {
  schemaVersion: number;
  generatorSlug: string;
  buildId: string;
  previousBuildId: string | null;
  selectedProfiles: Array<{id:string}>;
  imports: Array<{alias:string; importName:string}>;
  files: ManifestFile[];
  entry: { htmlPath: string; pjsPath: string; scriptPath: string; stylesheetPath: string; buildInfoId: string };
  [k: string]: unknown;
}

export function lintManifest(m: GeneratorManifest, fileBytes: Map<string, Uint8Array>, shaOf: (u: Uint8Array)=>string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (m.schemaVersion !== 4) issues.push({code:'MANIFEST_VERSION'});
  const names = m.files.map(f=>f.runtimePath);
  if (new Set(names).size !== names.length) issues.push({code:'DUPLICATE_FILES'});
  const sorted = [...names].sort();
  if (JSON.stringify(names) !== JSON.stringify(sorted)) issues.push({code:'FILE_ORDER'});
  for (const req of ['main.pjs','index.html', m.entry.scriptPath, m.entry.stylesheetPath]) {
    if (names.filter(n=>n===req).length !== 1) issues.push({code:'ENTRY_MISSING', detail:req});
  }
  if (m.entry.buildInfoId !== m.buildId) issues.push({code:'BOOT_BUILD_MISMATCH'});
  if (!m.entry.scriptPath.includes(m.buildId) || !m.entry.stylesheetPath.includes(m.buildId)) {
    issues.push({code:'ENTRY_BUILDID'});
  }
  for (const f of m.files) {
    const runtime = f.runtimePath;
    const archive = f.archivePath ?? runtime;
    if (runtime.startsWith('/') || archive.startsWith('/') || runtime.includes('..') || archive.includes('..')) {
      issues.push({code:'PATH_TRAVERSAL', detail:runtime}); continue;
    }
    if (runtime.startsWith('src/') && runtime.split('/').length !== 2) issues.push({code:'NOT_FLAT_SRC', detail:runtime});
    const bytes = fileBytes.get(archive);
    if (!bytes) { issues.push({code:'MISSING_FILE', detail:archive}); continue; }
    if (bytes.length !== f.bytes || shaOf(bytes) !== f.sha256) issues.push({code:'FILE_HASH', detail:archive});
  }
  return issues;
}

export function composeImports(selectedProfiles: string[]): { lines: string[]; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  const byAlias = new Map<string,string>();
  const lines: string[] = [];
  for (const p of selectedProfiles) {
    const found = PROFILE_BINDINGS.filter(b=>b.profile===p);
    if (found.length === 0) { issues.push({code:'IMPORT_UNKNOWN', detail:p}); continue; }
    for (const b of found) {
      const prev = byAlias.get(b.alias);
      if (prev !== undefined && prev !== b.importName) {
        issues.push({code:'IMPORT_INVALID', detail:'conflict '+b.alias});
        continue;
      }
      if (prev === undefined) { byAlias.set(b.alias, b.importName); lines.push(b.alias+' = {import:'+b.importName+'}'); }
    }
  }
  return { lines, issues };
}
