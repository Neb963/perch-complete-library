import { ok, err, unknown, unavailable, FakeKvFolder, FakeTextStream, FakeOutcome } from '../src/core/outcome.js';
async function main(): Promise<void> {
  if (ok(1).kind !== 'ok') throw new Error('ok');
  if (err('BAD_INPUT','x').kind !== 'error') throw new Error('err');
  if (unknown('t').kind !== 'unknown') throw new Error('unknown');
  if (unavailable('u').kind !== 'unavailable') throw new Error('unavailable');
  const f = new FakeKvFolder();
  await f.set('k', {v:1});
  try { await f.update('k', () => { throw new Error('CONFLICT'); }); } catch {}
  const after = await f.get('k');
  if (JSON.stringify(after) !== JSON.stringify({v:1})) throw new Error('no-write');
  let caught = false;
  try { await f.update('k', () => undefined as unknown as {v:number}); } catch { caught = true; }
  if (!caught) throw new Error('undefined updater');
  caught = false;
  try { await f.update('k', (() => Promise.resolve({v:2})) as unknown as (b:{v:number}|undefined)=>{v:number}); } catch { caught = true; }
  if (!caught) throw new Error('promise updater');
  // late/duplicate + timeout injectors
  const o = new FakeOutcome({x:1});
  o.inject('timeout');
  const t = await o.run('op1');
  if (t.kind !== 'unknown') throw new Error('timeout must be unknown');
  o.inject('syncThrow');
  let syncThrew = false;
  try { await o.run('op2'); } catch { syncThrew = true; }
  if (!syncThrew) throw new Error('syncThrow');
  // text fake late callback: stopped op still receives chunk but consumer must fence
  const txt = new FakeTextStream();
  const chunks: string[] = [];
  const h = txt.start({ onChunk: (c) => { chunks.push(c.fullTextSoFar); } });
  if ('error' in h) throw new Error('start');
  h.stop();
  txt.chunk(h.id, 'a', 'a');
  if (chunks.length !== 1) throw new Error('chunk');
  console.log('PASS outcome comprehensive');
}
await main();
