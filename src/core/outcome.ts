// S3-02 shared port result types + deterministic fakes (strict v0.3.6 §7, §22)
// Reference source-level contract types; Outcome fakes with sync throw/timeout/late-callback injectors.

export type PortErrorCode =
  | 'BAD_INPUT' | 'UNSUPPORTED_MODE' | 'MISSING_BINDING' | 'BOOT_ASSET_UNAVAILABLE'
  | 'BOOT_TIMEOUT' | 'BOOT_BUILD_MISMATCH' | 'BOOT_APP_EXCEPTION'
  | 'PREVIEW_SW_UNAVAILABLE' | 'NATIVE_SYNC_THROW' | 'NATIVE_REJECTED' | 'NATIVE_MALFORMED'
  | 'TEXT_MALFORMED_FINAL' | 'TEXT_PREFIX_MISMATCH' | 'TEXT_STOP_THROW'
  | 'TEXT_DISPATCH_LIMIT' | 'TEXT_CONTEXT_LIMIT'
  | 'IMAGE_BAD_OUTPUT' | 'IMAGE_HOST_FAILED' | 'IMAGE_DISPATCH_LIMIT'
  | 'ROOM_NOT_READY' | 'ROOM_SUBMIT_FAILED' | 'ROOM_IDENTITY_UNCERTAIN'
  | 'ROOM_MOUNT_UNQUALIFIED' | 'ROOM_CHANNEL_INVALID'
  | 'STORE_UNAVAILABLE' | 'STORE_CORRUPT' | 'STORE_QUOTA'
  | 'STORE_SCAN_BUDGET' | 'STORE_TOO_MANY_RECORDS' | 'STORE_RECOVERY_UNQUALIFIED' | 'STORE_TOMBSTONE_CONFLICT' | 'REVISION_CONFLICT'
  | 'SCHEMA_MIGRATION_REQUIRED' | 'SCHEMA_TOO_NEW' | 'MIGRATION_BACKUP_REQUIRED'
  | 'MIGRATION_CONFLICT' | 'IMPORT_INVALID' | 'IMPORT_CAPACITY'
  | 'IMPORT_DEPENDENCY_CHANGED' | 'IMPORT_PARTIAL' | 'EXPORT_NON_SNAPSHOT'
  | 'URL_INVALID' | 'URL_STATE_UNQUALIFIED' | 'CLASSIFIER_UNAVAILABLE'
  | 'RELEASE_INVALID' | 'EVIDENCE_UNQUALIFIED' | 'UNKNOWN_NATIVE_OUTCOME';

export type PortError = { code: PortErrorCode; recoverability: 'retry_user' | 'reconcile' | 'none'; safeMessage: string };
export type Outcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'error'; error: PortError }
  | { kind: 'unknown'; reason: string }
  | { kind: 'unavailable'; reason: string };

export function ok<T>(value: T): Outcome<T> { return { kind: 'ok', value }; }
export function err<T>(code: PortErrorCode, safeMessage: string, recoverability: PortError['recoverability'] = 'none'): Outcome<T> {
  return { kind: 'error', error: { code, safeMessage, recoverability } };
}
export function unknown<T>(reason: string): Outcome<T> { return { kind: 'unknown', reason }; }
export function unavailable<T>(reason: string): Outcome<T> { return { kind: 'unavailable', reason }; }

export function isOk<T>(o: Outcome<T>): o is { kind: 'ok'; value: T } { return o.kind === 'ok'; }

export type Diagnostic = { code: string; capability?: string; operationId?: string; phase?: string; buildId?: string };
export type DiagnosticSink = (e: Diagnostic) => void;
export function makeDiagnosticSink(): { sink: DiagnosticSink; events: Diagnostic[] } {
  const events: Diagnostic[] = [];
  return { sink: (e) => { events.push({ ...e }); }, events };
}

// Deterministic fault-injection fakes. NEVER native semantics.
export type FailureMode = 'none' | 'syncThrow' | 'asyncReject' | 'neverSettle' | 'lateCallback' | 'duplicateCallback' | 'timeout';

export class FakeOutcome<T> {
  calls: string[] = [];
  mode: FailureMode = 'none';
  lateValue: T | null = null;
  constructor(private readonly value: T) {}
  inject(mode: FailureMode, lateValue?: T): void { this.mode = mode; if (lateValue !== undefined) this.lateValue = lateValue; }
  async run(op: string): Promise<Outcome<T>> {
    this.calls.push(op);
    if (this.mode === 'syncThrow') { this.mode = 'none'; throw new Error('INJECTED_SYNC_THROW:'+op); }
    if (this.mode === 'asyncReject') { this.mode = 'none'; return err('NATIVE_REJECTED', 'injected async rejection', 'retry_user'); }
    if (this.mode === 'neverSettle') { return new Promise(()=>{}); }
    if (this.mode === 'timeout') { this.mode = 'none'; return unknown('injected timeout:'+op); }
    return ok(structuredClone(this.value));
  }
}

export class FakeKvFolder {
  private readonly records = new Map<string, unknown>();
  readonly calls: string[] = [];
  failNext: 'read' | 'write' | null = null;
  private clone<V>(v: V): V { return structuredClone(v); }
  async get<V>(key: string): Promise<V | undefined> {
    this.calls.push('get:'+key);
    if (this.failNext === 'read') { this.failNext = null; throw new Error('INJECTED_READ_FAILURE'); }
    return this.clone(this.records.get(key) as V | undefined);
  }
  async set<V>(key: string, v: V): Promise<void> {
    this.calls.push('set:'+key);
    if (this.failNext === 'write') { this.failNext = null; throw new Error('INJECTED_WRITE_FAILURE'); }
    this.records.set(key, this.clone(v));
  }
  async delete(key: string): Promise<void> { this.calls.push('delete:'+key); this.records.delete(key); }
  async keys(): Promise<string[]> { return [...this.records.keys()].sort(); }
  async getMany<V>(keys: readonly string[]): Promise<Array<V | undefined>> {
    return Promise.all(keys.map(k=>this.get<V>(k)));
  }
  async update<V>(key: string, updater: (before: V | undefined) => V): Promise<void> {
    this.calls.push('update:'+key);
    if (this.failNext === 'write') { this.failNext = null; throw new Error('INJECTED_WRITE_FAILURE'); }
    const existing = this.clone(this.records.get(key) as V | undefined);
    let proposed: unknown;
    try { proposed = updater(existing); } catch (e) { throw e; }
    if (proposed === undefined || (proposed !== null && (typeof proposed === 'object' || typeof proposed === 'function') && 'then' in (proposed as object) && typeof (proposed as {then?: unknown}).then === 'function')) {
      throw new TypeError('UPDATER_MUST_RETURN_CLONEABLE_SYNCHRONOUS_VALUE');
    }
    this.records.set(key, this.clone(proposed));
  }
  injectRawForTest(key: string, raw: unknown): void { this.records.set(key, raw); }
}

export class FakeTextStream {
  requests = 0;
  readonly pending = new Map<number, { stopRequested: boolean; onChunk?: (c: {textChunk:string; fullTextSoFar:string; isFromStartWith:boolean})=>void; onFinish?: (x:{text:string})=>void }>();
  failNextStart: FailureMode = 'none';
  start(hooks: { onChunk?: (c: {textChunk:string; fullTextSoFar:string; isFromStartWith:boolean})=>void; onFinish?: (x:{text:string})=>void }): { id: number; stop: ()=>void } | { error: string } {
    if (this.failNextStart === 'syncThrow') { this.failNextStart = 'none'; throw new Error('INJECTED_TEXT_SYNC_THROW'); }
    const id = ++this.requests;
    this.pending.set(id, { stopRequested: false, ...(hooks.onChunk ? { onChunk: hooks.onChunk } : {}), ...(hooks.onFinish ? { onFinish: hooks.onFinish } : {}) });
    return { id, stop: () => { const it = this.pending.get(id); if (it) it.stopRequested = true; } };
  }
  chunk(id: number, textChunk: string, fullTextSoFar: string, isFromStartWith = false): void {
    this.pending.get(id)?.onChunk?.({ textChunk, fullTextSoFar, isFromStartWith });
  }
  finish(id: number, text: string): void {
    const it = this.pending.get(id); if (!it) return;
    it.onFinish?.({ text }); this.pending.delete(id);
  }
  lateDuplicate(id: number, textChunk: string, fullTextSoFar: string): void {
    // late/duplicate callback after finish must be ignored by consumer (test asserts no crash)
    this.pending.get(id)?.onChunk?.({ textChunk, fullTextSoFar, isFromStartWith: false });
  }
}
