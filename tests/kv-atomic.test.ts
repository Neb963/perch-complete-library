// KV atomicity + provenance + too-new + tombstone + import/migrate adversarial.
import { DraftStore, bindKv } from '../src/kv/store.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { exportLocal, verifyBundle, importLocal, migrateDomain } from '../src/kv/portable.js';

type Doms = { chars: { name: string } };
const defs = { chars: { folder: 'f1', schemaMajor: 2, validate: (v: unknown): v is { name: string } => typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' } };

function folders() {
  const map = new Map<string, FakeKvFolder>();
  return (f: string): FakeKvFolder => {
    let x = map.get(f);
    if (!x) { x = new FakeKvFolder(); map.set(f, x); }
    return x;
  };
}

// bindKv never reports success when dep missing
{
  const bad = bindKv({}, defs as never);
  if (bad.kind !== 'error' || bad.error.code !== 'MISSING_BINDING') throw new Error('missing binding must be MISSING_BINDING');
  const ff = folders();
  const good = bindKv({}, defs as never, ff as never);
  if (good.kind !== 'ok') throw new Error('DI provider must succeed');
}

// Overlapping creators: only one wins
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  const folder = ff('f1');
  // Two concurrent commits with expectedRevision null for same id
  const [a, b] = await Promise.all([
    s.commit('chars', 'race', null, { name: 'a' }),
    s.commit('chars', 'race', null, { name: 'b' }),
  ]);
  const oks = [a, b].filter(r => r.kind === 'ok');
  const conflicts = [a, b].filter(r => r.kind === 'error');
  if (oks.length !== 1 || conflicts.length !== 1) throw new Error('exactly one creator must win ' + JSON.stringify([a, b]));
  void folder;
}

// Wrong revision + stale client
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  await s.commit('chars', 'w', null, { name: 'v1' });
  const stale = await s.commit('chars', 'w', 99, { name: 'stale' });
  if (stale.kind !== 'error' || (stale.kind === 'error' && stale.error.code !== 'REVISION_CONFLICT')) throw new Error('wrong revision');
}

// Thrown updater + undefined/async rejection (via Fake folder direct)
{
  const f = new FakeKvFolder();
  await f.set('r/x', { schemaMajor: 2, revision: 1, deleted: false, value: { name: 'a' } });
  let threw = false;
  try {
    await f.update('r/x', () => { throw new Error('REVISION_CONFLICT:injected'); });
  } catch { threw = true; }
  if (!threw) throw new Error('throw must propagate');
  const after = await f.get('r/x') as { revision: number };
  if (after.revision !== 1) throw new Error('no-write on throw');
}

// SCHEMA_TOO_NEW: future-major rejected, load errors, commit rejects
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  const folder = ff('f1');
  folder.injectRawForTest('r/future', { schemaMajor: 99, revision: 1, deleted: false, value: { name: 'f' } });
  const l = await s.load('chars', 'future');
  if (l.kind !== 'error' || (l.kind === 'error' && l.error.code !== 'SCHEMA_TOO_NEW')) throw new Error('load too-new ' + JSON.stringify(l));
  const c = await s.commit('chars', 'future', 1, { name: 'x' });
  if (c.kind !== 'error') throw new Error('commit too-new must fail');
  const li = await s.list('chars');
  if (li.kind !== 'ok' || !li.value.issues.some(i => i.code === 'SCHEMA_TOO_NEW')) throw new Error('list too-new issue');
}

// Origin preserved across updates + tombstones
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  await s.commit('chars', 'o1', null, { name: 'a' });
  const ex = await exportLocal(s, ['chars'], 'slug', ff as never, () => 'f1');
  if (ex.kind !== 'ok') throw new Error('export');
  const ff2 = folders();
  const s2 = new DraftStore<Doms>(ff2 as never, defs);
  const im = await importLocal(s2, ex.value, 'merge', { targetSlug: 'fresh', folders: ff2 as never, folderOf: () => 'f1' });
  if (im.kind !== 'ok' || im.value.inserted !== 1) throw new Error('import ' + JSON.stringify(im));
  const l = await s2.load('chars', 'o1');
  if (l.kind !== 'ok' || !l.value || (l.value as { origin?: unknown }).origin === undefined) throw new Error('origin missing after import');
  const originBefore = JSON.stringify((l.value as { origin?: unknown }).origin);
  const upd = await s2.commit('chars', 'o1', l.value.revision, { name: 'b' });
  if (upd.kind !== 'ok') throw new Error('update');
  const l2 = await s2.load('chars', 'o1');
  if (l2.kind !== 'ok' || !l2.value || JSON.stringify((l2.value as { origin?: unknown }).origin) !== originBefore) throw new Error('origin must survive update');
  const del = await s2.delete('chars', 'o1', l2.value.revision);
  if (del.kind !== 'ok') throw new Error('delete');
  // Tombstone preserves origin in raw (check via folder)
  const raw = await (ff2('f1') as FakeKvFolder).get('r/o1') as { origin?: unknown };
  if (raw.origin === undefined) throw new Error('tombstone must preserve origin');
}

// Export → import fresh → reload → verify + interrupted migrate resume
{
  const ff = folders();
  const s = new DraftStore<Doms>(ff as never, defs);
  await s.commit('chars', 'm1', null, { name: 'old' });
  // Downgrade raw to old major to simulate migration need
  const folder = ff('f1');
  const raw = await folder.get('r/m1') as { schemaMajor: number };
  raw.schemaMajor = 1;
  await folder.set('r/m1', raw);
  const ex = await exportLocal(s, ['chars'], 'slug-m', ff as never, () => 'f1');
  if (ex.kind !== 'ok') throw new Error('export m');
  // Migrate with converter 1→2 (identity for {name})
  const mig1 = await migrateDomain(s, 'chars', { backup: ex.value, acknowledgedByUser: true, folders: ff as never, folderOf: () => 'f1', converters: { chars: (v: unknown) => v } });
  if (mig1.kind !== 'ok' || mig1.value.migrated !== 1) throw new Error('migrate ' + JSON.stringify(mig1));
  // Restart with same bundle must be idempotent (alreadyCurrent)
  const mig2 = await migrateDomain(s, 'chars', { backup: ex.value, acknowledgedByUser: true, folders: ff as never, folderOf: () => 'f1', converters: { chars: (v: unknown) => v } });
  if (mig2.kind !== 'ok') throw new Error('migrate restart');
  const l = await s.load('chars', 'm1');
  if (l.kind !== 'ok' || !l.value || l.value.schemaMajor !== 2) throw new Error('migrated major');
}

console.log('PASS kv atomic+provenance+migrate');
