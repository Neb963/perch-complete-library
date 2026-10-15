// S3-13 chat data model (Reference A) — Character/Conversation/attempts, branching, detached projection.
export type CharacterRecord = { id: string; incarnationId: string; name: string; systemPrompt: string };
export type ChatTurn = { id: string; parentTurnId: string | null; branchId: string; speaker: { kind: 'user' | 'ai' | 'human'; participantId: string; displayName: string }; text: string; revision: number; status: 'final'; steerInstruction?: string | null | undefined; originOperationId?: string | null | undefined };
export type ChatAttempt = { operationId: string; parentTurnId: string | null; branchId: string; state: 'pending' | 'stop_requested' | 'failed' | 'unknown'; draftText: string; originSessionId: string; startedAt: string; finishedAt?: string | undefined; errorCode?: string | undefined };
export type BranchSummary = { text: string; coveredThroughTurnId: string; coveredThroughRevision: number; branchId: string; coveredTurnHashes: string[] };
export type ConversationRecord = { id: string; characterId: string; characterIncarnationId: string; characterSnapshot: { name: string; systemPrompt: string }; participants: Array<{ id: string; kind: 'user' | 'ai' | 'human'; displayName: string }>; turns: ChatTurn[]; attempts: ChatAttempt[]; activeBranchId: string; activeBranchLeafId: string | null; summary: BranchSummary | null; draft: string; characterState: 'linked' | 'detached' };

export function effectiveLink(character: { deleted: boolean; value: { incarnationId: string } | null } | null, conv: Pick<ConversationRecord, 'characterState' | 'characterIncarnationId'>): 'linked' | 'detached' {
  if (conv.characterState === 'detached') return 'detached';
  if (!character || character.deleted || !character.value) return 'detached';
  if (character.value.incarnationId !== conv.characterIncarnationId) return 'detached';
  return 'linked';
}

// Summary virtual boundary: when a BranchSummary exists, the first retained turn may
// legitimately reference the virtual summary boundary id (coveredThroughTurnId or
// 'summary-boundary:<branchId>'). That reference terminates the chain without DANGLING.
function isVirtualBoundary(id: string, summary: BranchSummary | null, branchId: string): boolean {
  if (!summary) return false;
  if (id === summary.coveredThroughTurnId) return true;
  if (id === 'summary-boundary:' + branchId) return true;
  if (id === 'summary-boundary') return true;
  return false;
}

export function ancestorChain<T extends { id: string; parentTurnId: string | null }>(turns: T[], leafId: string | null, summary?: BranchSummary | null, branchId?: string): T[] {
  if (leafId === null) return [];
  const byId = new Map(turns.map(t => [t.id, t]));
  const out: T[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafId;
  const sum = summary ?? null;
  const br = branchId ?? '';
  while (cur !== null) {
    if (seen.has(cur)) throw new Error('CYCLE');
    seen.add(cur);
    const t = byId.get(cur);
    if (!t) {
      if (isVirtualBoundary(cur, sum, br)) return out;
      // When summary context is passed via conversation, allow its boundary too.
      throw new Error('DANGLING:' + cur);
    }
    out.unshift(t);
    cur = t.parentTurnId;
    // If parent is a virtual boundary, terminate cleanly.
    if (cur !== null && isVirtualBoundary(cur, sum, br)) break;
  }
  return out;
}

export function ancestorChainForConversation(conv: ConversationRecord, leafId: string | null): ChatTurn[] {
  return ancestorChain(conv.turns, leafId, conv.summary, conv.activeBranchId);
}

export function buildPrompt(conv: ConversationRecord, keep?: number): string {
  const chain = ancestorChainForConversation(conv, conv.activeBranchLeafId).filter(t => t.branchId === conv.activeBranchId);
  const tail = keep === undefined ? chain : chain.slice(-keep);
  const lines = tail.map(t => t.speaker.displayName + ': ' + t.text);
  if (conv.summary) lines.unshift('[Summary:' + conv.summary.text + ']');
  return lines.join('\n\n');
}

export function newConversation(id: string, character: CharacterRecord): ConversationRecord {
  return { id, characterId: character.id, characterIncarnationId: character.incarnationId, characterSnapshot: { name: character.name, systemPrompt: character.systemPrompt }, participants: [{ id: 'u1', kind: 'user', displayName: 'User' }, { id: 'a1', kind: 'ai', displayName: character.name }], turns: [], attempts: [], activeBranchId: 'b1', activeBranchLeafId: null, summary: null, draft: '', characterState: 'linked' };
}
