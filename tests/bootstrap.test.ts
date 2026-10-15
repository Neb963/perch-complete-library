import { buildSentinelHtml, buildIndexHtml, composePackage, classifyBootError } from '../src/bootstrap/sentinel.js';
import { bindHostEnvironment } from '../src/host/bindHost.js';
import { lintPjs, lintHtml } from '../src/bootstrap/linter.js';

// sentinel first + owned assets
{
  const html = buildIndexHtml({ buildId: 'testbuild1', modulePath: 'src/app-testbuild1.js', stylePath: 'src/app-testbuild1.css' });
  const lint = lintHtml(html);
  const bad = lint.issues.filter(i=>i.code==='SENTINEL_NOT_FIRST' || i.code==='OWNED_BOOT_ASSET_MISMATCH');
  if (bad.length) throw new Error('sentinel html lint ' + JSON.stringify(lint.issues));
  if (!html.includes('data-pc-boot-asset="module"') || !html.includes('data-pc-boot-asset="style"')) throw new Error('missing tokens');
  if (!html.includes('testbuild1')) throw new Error('missing buildId');
  // classic sentinel must not contain PJS active brackets in text nodes (script excluded)
  // ensure sentinel contains ordinary {} (permitted)
  if (!html.includes('function')) throw new Error('sentinel body');
}
// compose + PJS roundtrip
{
  const c = composePackage({ buildId: 'b1', previousBuildId: null, generatorSlug: 'demo', selectedProfiles: ['ai.text@1','storage.kv@1'] });
  if (!c.mainPjs.includes('generateText = {import:ai-text-plugin}')) throw new Error('compose text');
  if (!c.mainPjs.includes('kv = {import:kv-plugin}')) throw new Error('compose kv');
  const p = lintPjs(c.mainPjs);
  if (p.issues.length) throw new Error('composed pjs lint ' + JSON.stringify(p.issues));
  // gallery dedup: ai.image + gallery share one line
  const g = composePackage({ buildId: 'b1', previousBuildId: null, generatorSlug: 'demo', selectedProfiles: ['ai.image@1','gallery.native@1'] });
  if (g.manifestImports.length !== 1) throw new Error('gallery dedup');
}
// boot classifier
{
  if (classifyBootError({owned:false, kind:'resource'}) !== null) throw new Error('ad must not fail boot');
  if (classifyBootError({owned:true, kind:'resource'}) !== 'BOOT_ASSET_UNAVAILABLE') throw new Error('owned resource');
  if (classifyBootError({owned:true, kind:'runtime'}) !== 'BOOT_APP_EXCEPTION') throw new Error('owned runtime');
}
// host: identity + query/hash scope
{
  const h = bindHostEnvironment({}, { generatorName: 'demo-gen', generatorIsUnsaved: true, generatorIsInEditMode: true, locationHref: 'https://x.perchance.org/demo-gen?probe=1#sec', pathname: '/demo-gen' });
  const id = h.generatorIdentity();
  if (id.name !== 'demo-gen' || id.isUnsaved !== true) throw new Error('identity');
  const r = h.readUrlState(['probe']);
  if (r.kind !== 'ok' || r.value.query['probe'] !== '1') throw new Error('read allowed ' + JSON.stringify(r));
  const rej = h.readUrlState(['other']);
  if (rej.kind !== 'error') throw new Error('unknown key must reject');
  const dup = bindHostEnvironment({}, { generatorName: 'g', locationHref: 'https://x/g?a=1&a=2', pathname: '/g' });
  const d = dup.readUrlState();
  if (d.kind !== 'error') throw new Error('duplicate must be BAD');
  const share = h.canonicalShareUrl({ query: { probe: '1' } });
  if (share.kind !== 'ok' || !share.value.url.startsWith('https://perchance.org/demo-gen')) throw new Error('share url');
  if (share.value.publication !== 'known_unsaved') throw new Error('publication');
  const unk = bindHostEnvironment({}, { generatorName: 'g2', generatorIsUnsaved: null as unknown as boolean, locationHref: 'https://x/g2', pathname: '/g2' });
  const s2 = unk.canonicalShareUrl();
  if (s2.kind !== 'ok' || s2.value.publication !== 'unknown') throw new Error('unknown publication');
  const rep = h.replaceUrlState({ query: { probe: '2' }, hash: 'sec2' });
  if (rep.kind !== 'ok') throw new Error('replace');
  const badHash = h.replaceUrlState({ hash: '#bad' });
  if (badHash.kind !== 'error') throw new Error('hash prefix');
}
console.log('PASS bootstrap+host');
