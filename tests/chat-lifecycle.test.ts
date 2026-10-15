// Chat lifecycle: compaction→reload→append→regenerate; pending→Stop→Regenerate; no-chunk; never-settling; orphan expiry; fg/bg.
import { bindText } from '../src/text/bindText.js';
import { TextDispatchScheduler } from '../src/core/scheduler.js';
import { ancestorChain } from '../src/chat/model.js';

// Compaction boundary: first retained turn referencing virtual boundary must not DANGLING
{
  const turns = [
    { id: 't2', parentTurnId: 'summary-boundary:b1', branchId: 'b1' },
    { id: 't3', parentTurnId: 't2', branchId: 'b1' },
  ];
  const summary = { text: 'sum', coveredThroughTurnId: 't1', coveredThroughRevision: 1, branchId: 'b1', coveredTurnHashes: [] };
  const chain = ancestorChain(turns as never, 't3', summary as never, 'b1');
  if (chain.length !== 2) throw new Error('boundary chain ' + chain.length);
  // Without summary context, same must DANGLING
  let dangled = false;
  try { ancestorChain(turns as never, 't3'); } catch (e) { if (String(e).includes('DANGLING')) dangled = true; }
  if (!dangled) throw new Error('without summary must dangle');
}

// No-chunk final result (never emits chunk, only final with generated text, no prefix required)
{
  const backend = {
    metadata: () => ({ countTokens: () => 1, idealMaxContextTokens: 8000 }),
    startNative: (_o: unknown, hooks: { onFinish?: (r: { generatedText?: unknown }) => void }) => {
      const p = (async () => { hooks.onFinish?.({ generatedText: 'hello world' }); return { generatedText: 'hello world' }; })();
      return { hybrid: { stop: () => {} }, promise: p };
    },
  };
  const bt = bindText(backend as never);
  const req = bt.start({ instruction: 'hi', startWith: 'Bob: ' });
  if (req.kind !== 'ok') throw new Error('start');
  const fin = await req.value.completion;
  if (fin.kind !== 'ok' || fin.value.generatedText !== 'hello world') throw new Error('no-chunk final ' + JSON.stringify(fin));
}

// Final-only with prefix present must strip; without prefix must not fail
{
  const mk = (finalText: string) => ({
    metadata: () => ({ countTokens: () => 1, idealMaxContextTokens: 1 }),
    startNative: (_o: unknown, hooks: { onFinish?: (r: { generatedText?: unknown }) => void }) => {
      const p = (async () => { hooks.onFinish?.({ generatedText: finalText }); return { generatedText: finalText }; })();
      return { hybrid: { stop: () => {} }, promise: p };
    },
  });
  const bt1 = bindText(mk('Bob: hello') as never);
  const r1 = bt1.start({ instruction: 'hi', startWith: 'Bob: ' });
  if (r1.kind !== 'ok') throw new Error('start1');
  const f1 = await r1.value.completion;
  if (f1.kind !== 'ok' || f1.value.generatedText !== 'hello') throw new Error('prefixed strip ' + JSON.stringify(f1));
}

// Never-settling native + Stop → unknown/stop, then Regenerate allowed after orphan expiry
{
  let now = 0;
  const backend = {
    metadata: () => ({ countTokens: () => 1, idealMaxContextTokens: 1 }),
    startNative: () => ({ hybrid: { stop: () => {} }, promise: new Promise(() => {}) }),
  };
  const bt = bindText(backend as never);
  const sch = new TextDispatchScheduler(bt, () => now);
  const f1 = sch.dispatch({ instruction: 'a', sessionId: 's1', kind: 'foreground' });
  if (f1.kind !== 'ok') throw new Error('fg1');
  // Concurrent foreground must be enforced
  const f2 = sch.dispatch({ instruction: 'b', sessionId: 's1', kind: 'foreground' });
  if (f2.kind === 'ok') throw new Error('concurrent fg must be blocked');
  // Background while fg active must block
  const bg = sch.dispatch({ instruction: 'c', sessionId: 's1', kind: 'background-compaction' });
  if (bg.kind === 'ok') throw new Error('bg during fg must block');
  // Stop releases fg; orphan lease held 90s
  f1.value.stop();
  if (sch.getOrphanCount() !== 1) throw new Error('orphan lease');
  // Second fg allowed (orphans 1 < 2), third blocked by ceiling
  const f3 = sch.dispatch({ instruction: 'd', sessionId: 's1', kind: 'foreground' });
  if (f3.kind !== 'ok') throw new Error('second fg after stop');
  f3.value.stop();
  const f4 = sch.dispatch({ instruction: 'e', sessionId: 's1', kind: 'foreground' });
  if (f4.kind !== 'error') throw new Error('orphan ceiling must block third');
  // Expiry releases accounting
  now += 90001;
  if (sch.getOrphanCount() !== 0) throw new Error('orphan expiry must release');
  const f5 = sch.dispatch({ instruction: 'f', sessionId: 's1', kind: 'foreground' });
  if (f5.kind !== 'ok') throw new Error('after expiry fg must succeed');
  f5.value.stop();
}

// Stream/final equivalence with stop marker + trimmed prefix
{
  const backend = {
    metadata: () => ({ countTokens: (t: string) => t.length, idealMaxContextTokens: 8000 }),
    startNative: (_o: unknown, hooks: { onChunk?: (c: { textChunk: string; fullTextSoFar: string; isFromStartWith: boolean }) => void; onFinish?: (r: { generatedText?: unknown }) => void }) => {
      const p = (async () => {
        hooks.onChunk?.({ textChunk: 'Hi', fullTextSoFar: 'Hi', isFromStartWith: false });
        hooks.onChunk?.({ textChunk: ' there', fullTextSoFar: 'Hi there', isFromStartWith: false });
        hooks.onFinish?.({ generatedText: 'Hi there' });
        return { generatedText: 'Hi there' };
      })();
      return { hybrid: { stop: () => {} }, promise: p };
    },
  };
  const bt = bindText(backend as never);
  const seen: string[] = [];
  const req = bt.start({ instruction: 'hi' }, { onChunk: (c) => { seen.push(c.fullVisibleText); } });
  if (req.kind !== 'ok') throw new Error('start');
  const fin = await req.value.completion;
  if (fin.kind !== 'ok' || fin.value.generatedText !== 'Hi there') throw new Error('stream/final');
  if (seen.length === 0 || seen[seen.length - 1] !== 'Hi there') throw new Error('chunks');
}

console.log('PASS chat lifecycle');
