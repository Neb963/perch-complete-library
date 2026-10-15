import { lintPjs, lintHtml, lintManifest, composeImports } from '../src/bootstrap/linter.js';
import { ok, err, FakeKvFolder, FakeTextStream } from '../src/core/outcome.js';

function eq(a: unknown, b: unknown, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function hasCode(issues: Array<{code:string}>, code: string): boolean { return issues.some(i=>i.code===code || i.code.startsWith(code)); }

// PJS-ALLOWLIST
{
  const r = lintPjs("generateText = {import:ai-text-plugin}\nkv = {import:kv-plugin}\n");
  if (r.issues.length !== 0) throw new Error('allowlist valid failed ' + JSON.stringify(r.issues));
  const bad = lintPjs("server = {import:server-plugin}\n");
  if (!hasCode(bad.issues,'IMPORT')) throw new Error('server must be rejected');
  const dup = lintPjs("kv = {import:kv-plugin}\nkv = {import:kv-plugin}\n");
  if (!hasCode(dup.issues,'IMPORT_DUPLICATE')) throw new Error('dup alias must fail');
}
// BOOT-BASIC / META
{
  const r = lintPjs("$meta\n  title = Demo\n  description = A demo\n\ngenerateText = {import:ai-text-plugin}\n");
  if (r.issues.length !== 0) throw new Error('meta valid ' + JSON.stringify(r.issues));
  const missing = lintPjs("$meta\n  title = Only\n");
  if (!hasCode(missing.issues,'META_VALUE')) throw new Error('meta missing description');
  const numeric = lintPjs("$meta\n  title = 123\n  description = hi\n");
  if (!hasCode(numeric.issues,'META')) throw new Error('numeric title');
  const brackets = lintPjs("$meta\n  title = A [b]\n  description = hi\n");
  if (!hasCode(brackets.issues,'META_VALUE')) throw new Error('brackets');
  const placement = lintPjs("generateText = {import:ai-text-plugin}\n$meta\n  title = A\n  description = B\n");
  if (!hasCode(placement.issues,'META_PLACEMENT')) throw new Error('placement');
}
// HTML-PJS-SCOPE / ASSET-PATHS / BOOT-OWNED-ASSET
{
  const good = lintHtml('<scr'+'ipt>var b=1;</scr'+'ipt><div id="app-root">hi</div><link data-pc-boot-asset="style" rel="stylesheet" href="src/app-abc.css"><scr'+'ipt data-pc-boot-asset="module" type="module" src="src/app-abc.js"></scr'+'ipt>');
  if (hasCode(good.issues,'SENTINEL_NOT_FIRST')) throw new Error('sentinel should be first');
  const badOrder = lintHtml('<div id="app-root">hi</div>');
  if (!hasCode(badOrder.issues,'SENTINEL_NOT_FIRST')) throw new Error('missing sentinel');
  const badId = lintHtml('<scr'+'ipt>s</scr'+'ipt><div id="root">x</div>');
  if (!hasCode(badId.issues,'DOM_ID')) throw new Error('bad id');
  const interp = lintHtml('<scr'+'ipt>s</scr'+'ipt><div id="app-x">[animal]</div>');
  if (!hasCode(interp.issues,'HTML_INTERPOLATION')) throw new Error('interp text');
  // JS braces inside script must NOT be flagged as PJS
  const jsBraces = lintHtml('<scr'+'ipt>var o={a:1}; function f(){return [1,2];}</scr'+'ipt><div id="app-x">plain</div>');
  if (hasCode(jsBraces.issues,'HTML_INTERPOLATION')) throw new Error('js braces false positive ' + JSON.stringify(jsBraces.issues));
}
// Manifest / compose
{
  const { lines, issues } = composeImports(['ai.image@1','gallery.native@1']);
  eq(lines.length, 1, 'dedup');
  eq(issues.length, 0, 'dedup issues');
  const bad = composeImports(['server.rpc@1']);
  if (bad.issues.length === 0) throw new Error('unknown profile must fail');
}
console.log('PASS linter comprehensive');
