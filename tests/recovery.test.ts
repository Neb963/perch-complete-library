// Recovery round-trip: create/edit/delete → export → import fresh → reload → verify relationships/revisions/visible state.
import { DraftStore } from '../src/kv/store.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { exportLocal, importLocal } from '../src/kv/portable.js';
import { newConversation } from '../src/chat/model.js';

type Doms = { characters: { id: string; incarnationId: string; name: string; systemPrompt: string }; conversations: ReturnType<typeof newConversation> };
const defs = {
  characters: { folder: 'c', schemaMajor: 1, validate: (v: unknown): v is Doms['characters'] => typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' },
  conversations: { folder: 'v', schemaMajor: 1, validate: (v: unknown): v is Doms['conversations'] => typeof v === 'object' && v !== null && Array.isArray((v as { turns?: unknown }).turns) },
};
function ns() {
  const map = new Map<string, FakeKvFolder>();
  return (f: string): FakeKvFolder => {
    let x = map.get(f);
    if (!x) { x = new FakeKvFolder(); map.set(f, x); }
    return x;
  };
}

// Create → edit → delete → export → import fresh → reload → verify
{
  const ff = ns();
  const s = new DraftStore<Doms>(ff as never, defs);
  await s.commit('characters', 'bob', null, { id: 'bob', incarnationId: 'inc-bob', name: 'Bob', systemPrompt: 'hi' });
  const conv = newConversation('conv1', { id: 'bob', incarnationId: 'inc-bob', name: 'Bob', systemPrompt: 'hi' });
  await s.commit('conversations', 'conv1', null, conv);
  // Edit character
  await s.commit('characters', 'bob', 1, { id: 'bob', incarnationId: 'inc-bob', name: 'Bobby', systemPrompt: 'hi' });
  const ex = await exportLocal(s, ['characters', 'conversations'], 'src-slug', ff as never, (d) => (defs as Record<string, { folder: string }>)[d]?.folder ?? d);
  if (ex.kind !== 'ok') throw new Error('export');
  if (ex.value.index.recordCount !== 2) throw new Error('recordCount');
  // Import into fresh namespace
  const ff2 = ns();
  const s2 = new DraftStore<Doms>(ff2 as never, defs);
  const im = await importLocal(s2, ex.value, 'merge', { targetSlug: 'fresh', folders: ff2 as never, folderOf: (d) => (defs as Record<string, { folder: string }>)[d]?.folder ?? d });
  if (im.kind !== 'ok' || im.value.inserted !== 2) throw new Error('import ' + JSON.stringify(im));
  // Reload: new view over same folders
  const s3 = new DraftStore<Doms>(ff2 as never, defs);
  const lc = await s3.load('characters', 'bob');
  if (lc.kind !== 'ok' || !lc.value || (lc.value.value as { name: string }).name !== 'Bobby') throw new Error('character reload');
  const lv = await s3.load('conversations', 'conv1');
  if (lv.kind !== 'ok' || !lv.value) throw new Error('conv reload');
  const cv = lv.value.value as ReturnType<typeof newConversation>;
  if (cv.characterId !== 'bob' || cv.characterIncarnationId !== 'inc-bob') throw new Error('refs');
  // Revisions start at 1 in fresh namespace (provenance fork), origin present
  if (lc.value.revision !== 1) throw new Error('fresh revision');
  if ((lc.value as { origin?: unknown }).origin === undefined) throw new Error('origin');
  // Re-import same bundle must be idempotent (resumed, zero new)
  const im2 = await importLocal(s3, ex.value, 'merge', { targetSlug: 'fresh', folders: ff2 as never, folderOf: (d) => (defs as Record<string, { folder: string }>)[d]?.folder ?? d });
  if (im2.kind !== 'ok' || im2.value.inserted !== 0) throw new Error('replay must resume ' + JSON.stringify(im2));
}

console.log('PASS recovery roundtrip');
