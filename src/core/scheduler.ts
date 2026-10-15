// S3-06 TextDispatchScheduler — single per native backend at composition root (v0.3.6 §22.4).
import { ok, err, type Outcome } from '../core/outcome.js';
import type { BoundText, TextOptions, TextFinal } from '../text/bindText.js';

export type SessionId = string;
export interface DispatchOpts extends TextOptions {
  sessionId: SessionId;
  kind: 'foreground' | 'background-compaction';
  conversationId?: string | undefined;
}

export class TextDispatchScheduler {
  private fgActive: { operationId: string; sessionId: SessionId } | null = null;
  private bgActive: { operationId: string; sessionId: SessionId } | null = null;
  private orphans: Array<{ operationId: string; expiresAt: number }> = [];
  private dispatchedThisSession = 0;
  private readonly maxUnsettled = 2;
  private unsettled = 0;
  constructor(private readonly text: BoundText, private readonly now: () => number = () => Date.now()) {}

  getOrphanCount(): number { this.reap(); return this.orphans.length; }

  // Expiry must actually release dispatch accounting: expired orphans no longer count
  // toward the orphan ceiling, so new foreground work can proceed.
  private reap(): void {
    const t = this.now();
    const before = this.orphans.length;
    this.orphans = this.orphans.filter(o => o.expiresAt > t);
    void before;
  }

  canDispatch(kind: 'foreground' | 'background-compaction'): Outcome<void> {
    this.reap();
    if (this.unsettled >= this.maxUnsettled) return err('TEXT_DISPATCH_LIMIT', 'too many unsettled');
    if (kind === 'background-compaction' && (this.fgActive || this.bgActive)) return err('TEXT_DISPATCH_LIMIT', 'foreground/background active');
    // Foreground concurrency: only one foreground at a time.
    if (kind === 'foreground' && this.fgActive) return err('TEXT_DISPATCH_LIMIT', 'foreground active');
    if (kind === 'foreground' && this.orphans.length >= 2) return err('TEXT_DISPATCH_LIMIT', 'orphan ceiling');
    return ok(undefined);
  }

  dispatch(opts: DispatchOpts, hooks?: { onChunk?: (c: { appendedText: string; fullVisibleText: string }) => void }): Outcome<{ operationId: string; completion: Promise<Outcome<TextFinal>>; stop: () => Outcome<{ stopInvoked: boolean }> }> {
    const gate = this.canDispatch(opts.kind);
    if (gate.kind !== 'ok') return gate as unknown as Outcome<never>;
    const started = this.text.start(opts, hooks);
    if (started.kind !== 'ok') return started as unknown as Outcome<never>;
    const { operationId, completion, requestStop } = started.value;
    this.dispatchedThisSession++;
    this.unsettled++;
    if (opts.kind === 'foreground') this.fgActive = { operationId, sessionId: opts.sessionId };
    else this.bgActive = { operationId, sessionId: opts.sessionId };
    let counted = true;
    let stopRecorded = false;
    let fullySettled = false;
    const release = (): void => { if (counted) { counted = false; this.unsettled = Math.max(0, this.unsettled - 1); } };
    const settle = (o: Outcome<TextFinal>): Outcome<TextFinal> => {
      fullySettled = true;
      release();
      this.orphans = this.orphans.filter(o => o.operationId !== operationId);
      if (this.fgActive?.operationId === operationId) this.fgActive = null;
      if (this.bgActive?.operationId === operationId) this.bgActive = null;
      return o;
    };
    const wrapped = completion.then(settle, (_e: unknown) => settle(err('NATIVE_REJECTED', 'rejected')));
    const stop = (): Outcome<{ stopInvoked: boolean }> => {
      if (fullySettled || stopRecorded) return err('TEXT_DISPATCH_LIMIT', 'already stopped or settled');
      const r = requestStop();
      this.reap();
      if (!stopRecorded && this.orphans.length < 2) {
        stopRecorded = true;
        this.orphans.push({ operationId, expiresAt: this.now() + 90000 });
      }
      if (this.fgActive?.operationId === operationId) this.fgActive = null;
      if (this.bgActive?.operationId === operationId) this.bgActive = null;
      release();
      return r;
    };
    return ok({ operationId, completion: wrapped, stop });
  }
}
