import { reloadFence, staleCallbackGuard, unknownRetention } from '../src/regression/crossCutting.js';
{
  const r = await reloadFence('sess-a','sess-b','op1');
  if (!r.ok) throw new Error('fence');
  if (!staleCallbackGuard(1,1)) throw new Error('current');
  if (staleCallbackGuard(1,2)) throw new Error('stale must be false');
  if (!unknownRetention('unknown')) throw new Error('unknown');
  if (unknownRetention('available')) throw new Error('available not retained');
}
console.log('PASS regressions');
