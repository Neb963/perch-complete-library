// Comments integrated: mount → initial → compose/submit → invoked/unknown → incoming → projection → dispose/reselect.
import { createRoomBinder } from '../src/comments/bindRoom.js';
import { installMiniDom, createTestHost } from './helpers/dom-shim.js';

installMiniDom();

function factoryWithSubmit(log: string[]) {
  return (_ch: string, _o: Record<string, unknown>) => ({
    toString: () => ' <iframe src="room"></iframe> ',
    submit: (t: string) => { log.push(t); },
    setNicknameForNextComment: (_n: string) => {},
    setAvatarUrlForNextComment: (_u: string) => {},
  });
}

// Mount → initial → incoming → projection → dispose
{
  const log: string[] = [];
  const binder = createRoomBinder(factoryWithSubmit(log));
  const host = createTestHost();
  const seen: Array<{ id: string; body: string }> = [];
  const m = binder.mount(
    { channel: 'plr1-room1', host: host as never, presentation: 'custom-qualified' },
    { onInitial: (xs) => { for (const x of xs) seen.push({ id: x.localId, body: x.bodyUnsafe }); }, onMessage: (x) => { seen.push({ id: x.localId, body: x.bodyUnsafe }); } },
  );
  if (m.kind !== 'ok') throw new Error('mount');
  // Host must actually contain iframe (not discarded) — check mounted child, not cleared innerHTML string
  const found = (host as unknown as { querySelector: (s: string) => unknown }).querySelector('iframe');
  if (!found) throw new Error('iframe must be mounted');
  m.value.dispatchInitial([{ localId: 'a', bodyUnsafe: 'hi' }]);
  m.value.dispatchMessage({ localId: 'b', bodyUnsafe: 'yo' });
  // Duplicate exactly-once
  m.value.dispatchMessage({ localId: 'b', bodyUnsafe: 'yo' });
  if (seen.length !== 2) throw new Error('projection ' + seen.length);
  const sub = await m.value.submit('hello');
  if (sub.kind !== 'invoked') throw new Error('submit invoked ' + JSON.stringify(sub));
  if (log.length !== 1 || log[0] !== 'hello') throw new Error('native submit not called once');
  m.value.disposeHost();
  // After dispose, submit must be error, incoming fenced
  const after = await m.value.submit('late');
  if (after.kind !== 'error') throw new Error('disposed submit must error');
  m.value.dispatchMessage({ localId: 'c', bodyUnsafe: 'late' });
  if (seen.length !== 2) throw new Error('disposed incoming must be fenced');
}

// Missing native submit() must be real error, never invoked
{
  const binder = createRoomBinder(() => ({ toString: () => ' <iframe></iframe> ' }));
  const host = createTestHost();
  const m = binder.mount(
    { channel: 'plr1-nosubmit', host: host as never, presentation: 'custom-qualified' },
    { onInitial: () => {}, onMessage: () => {} },
  );
  if (m.kind !== 'ok') throw new Error('mount2');
  const r = await m.value.submit('hi');
  if (r.kind !== 'error' || (r.kind === 'error' && r.error?.code !== 'ROOM_SUBMIT_FAILED')) throw new Error('missing submit must be ROOM_SUBMIT_FAILED ' + JSON.stringify(r));
}

// Channel change disposes previous (fencing)
{
  const binder = createRoomBinder(factoryWithSubmit([]));
  const h1 = createTestHost();
  const h2 = createTestHost();
  const seen1: string[] = [];
  const seen2: string[] = [];
  const m1 = binder.mount({ channel: 'plr1-a', host: h1 as never, presentation: 'custom-qualified' }, { onInitial: () => {}, onMessage: (x) => { seen1.push(x.localId); } });
  if (m1.kind !== 'ok') throw new Error('m1');
  const m2 = binder.mount({ channel: 'plr1-b', host: h2 as never, presentation: 'custom-qualified' }, { onInitial: () => {}, onMessage: (x) => { seen2.push(x.localId); } });
  if (m2.kind !== 'ok') throw new Error('m2');
  // Old handle fenced after reselect
  m1.value.dispatchMessage({ localId: 'x', bodyUnsafe: 'old' });
  if (seen1.length !== 0) throw new Error('old channel must be fenced');
  m2.value.dispatchMessage({ localId: 'y', bodyUnsafe: 'new' });
  if (seen2.length !== 1) throw new Error('new channel must deliver');
  const s = await m1.value.submit('old submit');
  if (s.kind !== 'error') throw new Error('old submit must error after reselect');
}

console.log('PASS comments integrated');
