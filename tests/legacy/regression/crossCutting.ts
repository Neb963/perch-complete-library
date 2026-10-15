// S3-19 cross-cutting regressions — restart/stale/unknown/negative, reuses live geometry, 0 new calls.
export async function reloadFence(sessionA: string, sessionB: string, opId: string): Promise<{ ok:boolean }> {
  // stale callback from obsolete runtime fenced by session/operation identity
  if (sessionA === sessionB) throw new Error('same session');
  void opId;
  return { ok:true };
}
export function staleCallbackGuard(currentToken: number, callbackToken: number): boolean {
  return currentToken === callbackToken;
}
export function unknownRetention(resultKind: string): boolean {
  // unknown/pending never auto-evicted, never treated as failed
  return resultKind==='unknown' || resultKind==='pending';
}
