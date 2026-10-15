import { truncateStop, terminalHoldback, projectStream, stripPrefix } from '../src/text/normalize.js';
import { bindText } from '../src/text/bindText.js';
import { TextDispatchScheduler } from '../src/core/scheduler.js';

// TEXT-STOP-NONTERMINAL + split + holdback
{
  const r = truncateStop('Hello\nUser:bad', ['\nUser:']);
  if (r.text !== 'Hello' || !r.stopped) throw new Error('stop');
  const hold = terminalHoldback('Hello\nUs', ['\nUser:']);
  if (hold !== 'Hello') throw new Error('holdback ' + hold);
  const noStop = truncateStop('Hello world', ['\nUser:']);
  if (noStop.stopped) throw new Error('no stop');
  // tie: longest wins
  const tie = truncateStop('aXY', ['XY','Y']);
  if (tie.text !== 'a' || tie.marker !== 'XY') throw new Error('tie');
}
// TEXT-PREFIX trimmed-space
{
  const s = stripPrefix('Bob:hello', '', false, 'Bob: ');
  if (!s.prefixOk || s.generated !== 'hello') throw new Error('prefix trim ' + JSON.stringify(s));
  const bad = stripPrefix('Alice:hi', '', false, 'Bob:');
  if (bad.prefixOk) throw new Error('prefix mismatch must fail');
}
// TEXT-STOP-SPLIT streaming
{
  const p1 = projectStream('Hello\nUs', '', ['\nUser:'], false);
  if (p1.visible !== 'Hello' || p1.stopped) throw new Error('split hold ' + JSON.stringify(p1));
  const p2 = projectStream('Hello\nUser:bad', '', ['\nUser:'], false);
  if (p2.visible !== 'Hello' || !p2.stopped) throw new Error('split stop');
}
// bindText happy + malformed + prefix mismatch via fake backend
{
  const backend = {
    metadata: () => ({ countTokens: (t: string)=> t.length, idealMaxContextTokens: 8000 }),
    startNative: (o: unknown, hooks: {onChunk?: (c:{textChunk:string; fullTextSoFar:string; isFromStartWith:boolean})=>void; onFinish?: (r:{generatedText?:unknown})=>void}) => {
      const h = { stop: () => {} };
      const p = (async () => {
        hooks.onChunk?.({ textChunk: 'Hello', fullTextSoFar: 'Hello', isFromStartWith: false });
        hooks.onChunk?.({ textChunk: '\nUser:bad', fullTextSoFar: 'Hello\nUser:bad', isFromStartWith: false });
        hooks.onFinish?.({ generatedText: 'Hello\nUser:bad' });
        return { generatedText: 'Hello\nUser:bad' };
      })();
      return { hybrid: h, promise: p };
    },
  };
  const bt = bindText(backend as never);
  const req = bt.start({ instruction: 'hi', stopSequences: ['\nUser:'] }, {});
  if (req.kind !== 'ok') throw new Error('start');
  const fin = await req.value.completion;
  if (fin.kind !== 'ok' || fin.value.generatedText !== 'Hello') throw new Error('final ' + JSON.stringify(fin));
  // malformed final
  const badBackend = {
    metadata: () => ({ countTokens: (t: string)=>1, idealMaxContextTokens: 1 }),
    startNative: (o: unknown, hooks: {onFinish?: (r:{})=>void}) => {
      const p = (async () => { hooks.onFinish?.({}); return {}; })();
      return { hybrid: {}, promise: p };
    },
  };
  const bt2 = bindText(badBackend as never);
  const r2 = bt2.start({ instruction: 'hi' });
  if (r2.kind !== 'ok') throw new Error('start2');
  const f2 = await r2.value.completion;
  if (f2.kind === 'ok') throw new Error('malformed must be error');
  // sync throw
  const throwBackend = {
    metadata: () => { throw new Error('x'); },
    startNative: () => { throw new Error('sync'); },
  };
  const bt3 = bindText(throwBackend as never);
  if (bt3.metadata().kind !== 'error') throw new Error('meta sync');
  const r3 = bt3.start({ instruction: 'hi' });
  if (r3.kind !== 'error') throw new Error('start sync must be error');
}
// scheduler: fg blocks bg, orphan ceiling
{
  const backend = {
    metadata: () => ({ countTokens: ()=>1, idealMaxContextTokens: 1 }),
    startNative: () => ({ hybrid: { stop: ()=>{} }, promise: new Promise(()=>{}) }),
  };
  const bt = bindText(backend as never);
  const sch = new TextDispatchScheduler(bt, ()=>0);
  const f1 = sch.dispatch({ instruction: 'a', sessionId: 's1', kind: 'foreground' });
  if (f1.kind !== 'ok') throw new Error('fg1');
  const bg = sch.dispatch({ instruction: 'b', sessionId: 's1', kind: 'background-compaction' });
  if (bg.kind === 'ok') throw new Error('bg must block while fg active');
  f1.value.stop();
  f1.value.stop();
  if (sch.getOrphanCount() !== 1) throw new Error('repeat stop must not create duplicate orphan leases');
  const f3 = sch.dispatch({ instruction: 'c', sessionId: 's1', kind: 'foreground' });
  if (f3.kind !== 'ok') throw new Error('one stopped orphan must not block foreground');
}
console.log('PASS text+scheduler');
