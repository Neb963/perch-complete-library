import { DraftStore } from '../src/kv/store.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { canonicalJson, H } from '../src/kv/canonical.js';
import { exportLocal, verifyBundle, applicationOrder } from '../src/kv/portable.js';

type Doms = { chars: { name: string } };
const defs = { chars: { folder: 'f1', schemaMajor: 1, validate: (v: unknown): v is {name:string} => typeof v === 'object' && v !== null && typeof (v as {name?:unknown}).name === 'string' } };

function folders() {
  const map = new Map<string, FakeKvFolder>();
  return (f: string): import('../src/kv/store.js').KvFolderLike => {
    let x = map.get(f); if (!x) { x = new FakeKvFolder(); map.set(f, x); } return x as unknown as import('../src/kv/store.js').KvFolderLike;
  };
}

// STORE-CREATE/UPDATE/DELETE + TOMBSTONE
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  const c1 = await s.commit('chars','a', null, {name:'x'});
  if (c1.kind !== 'ok') throw new Error('create');
  const dup = await s.commit('chars','a', null, {name:'y'});
  if (dup.kind !== 'error') throw new Error('dup create must conflict');
  const upd = await s.commit('chars','a', 1, {name:'y'});
  if (upd.kind !== 'ok' || upd.value.revision !== 2) throw new Error('update');
  const stale = await s.commit('chars','a', 1, {name:'z'});
  if (stale.kind === 'ok') throw new Error('stale must conflict');
  const del = await s.delete('chars','a', 2);
  if (del.kind !== 'ok') throw new Error('delete');
  const res = await s.commit('chars','a', 3, {name:'resurrect'});
  if (res.kind === 'ok' || (res.kind === 'error' && res.error.code !== 'STORE_TOMBSTONE_CONFLICT')) throw new Error('tombstone resurrection must be STORE_TOMBSTONE_CONFLICT');
  const del2 = await s.delete('chars','a', 3);
  if (del2.kind === 'ok' || (del2.kind === 'error' && del2.error.code !== 'STORE_TOMBSTONE_CONFLICT')) throw new Error('second delete tombstone conflict');
}
// STORE-UNDEFINED / ASYNC updater via guard
{
  const { DraftStore: DS } = await import('../src/kv/store.js');
  void DS;
  const f = new FakeKvFolder();
  await f.set('r/x', {schemaMajor:1, revision:1, deleted:false, value:{name:'a'}});
  let caught = false;
  try { await (f as unknown as {update:(k:string,u:(b:unknown)=>unknown)=>Promise<void>}).update('r/x', () => undefined); } catch { caught = true; }
  if (!caught) throw new Error('undefined updater');
}
// HASH-NUMERIC-KEYS: objects with numeric keys must use code-point ordering, not numeric reorder
{
  const a = canonicalJson({2:'b',10:'a',1:'c'});
  // code-point: "1" < "10" < "2"
  if (a !== '{"1":"c","10":"a","2":"b"}') throw new Error('numeric keys order ' + a);
  const u = canonicalJson({'é':'1','e':'2'});
  if (u !== '{"e":"2","é":"1"}') throw new Error('unicode order ' + u);
  const h1 = await H('portable-record-v1', canonicalJson({a:1}));
  const h2 = await H('portable-record-v1', canonicalJson({a:1}));
  if (h1 !== h2) throw new Error('hash stable');
}
// STORE-SCAN-ISSUES + IMPORT-REVERSED-DEPENDENCY-PARTS
{
  const ord = applicationOrder([[{domain:'conversations',id:'q'}],[{domain:'jobs',id:'local-history'},{domain:'characters',id:'c'}]]);
  if (JSON.stringify(ord) !== JSON.stringify([['characters','c'],['conversations','q'],['jobs','local-history']])) throw new Error('order');
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  // inject corrupt
  const folder = ff('f1') as unknown as FakeKvFolder;
  folder.injectRawForTest('r/bad', 'not-an-envelope');
  await s.commit('chars','good', null, {name:'g'});
  const list = await s.list('chars');
  if (list.kind !== 'ok' || !list.value.degraded || !list.value.issues.some(i=>i.code==='STORE_CORRUPT')) throw new Error('corrupt list ' + JSON.stringify(list));
}
// export/verify roundtrip
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  await s.commit('chars','e1', null, {name:'n1'});
  const ex = await exportLocal(s, ['chars'], 'slug-a', ff as never, ()=> 'f1');
  if (ex.kind !== 'ok') throw new Error('export');
  const v = await verifyBundle(ex.value);
  if (v.kind !== 'ok' || v.value.records.length !== 1) throw new Error('verify');
}
console.log('PASS kv comprehensive');
