// S3-04 KV binder + typed store (v0.3.6 §22.7)
// Single-key CAS, tombstone barriers, corrupt isolation, bounded listing, portable exchange hooks.
import { ok, err, type Outcome } from '../core/outcome.js';

export const ID_RE = /^[a-z0-9_-]{1,96}$/;
export function canonicalKey(id: string): string {
  if (!ID_RE.test(id)) throw new Error('BAD_ID:' + id);
  return 'r/' + id;
}

export type ImportOrigin = {
  attemptId: string;
  fileDigest: string;
  sourceDomain: string;
  sourceId: string;
  sourceRecordDigest: string;
};
export type StoredAggregate<T> = {
  schemaMajor: number;
  revision: number;
  deleted: boolean;
  value: T | null;
  origin?: ImportOrigin | undefined;
};
export type ListedSummary = { id: string; revision: number; schemaMajor: number; displayLabel: string | null; updatedAt: string | null };
export type CorruptEntry = { domain: string; id: string; reason: 'envelope' | 'shape' | 'unreadable' };
export type ListIssue =
  | { code: 'STORE_SCAN_BUDGET'; rawKeys: number; scanCap: number; scanned: number }
  | { code: 'STORE_TOO_MANY_RECORDS'; liveCount: number; liveCap: number }
  | { code: 'SCHEMA_MIGRATION_REQUIRED'; ids: string[]; count: number; currentMajor: number }
  | { code: 'SCHEMA_TOO_NEW'; ids: string[]; count: number; currentMajor: number }
  | { code: 'STORE_CORRUPT'; ids: string[]; count: number };
export type ListReport = { summaries: ListedSummary[]; corrupt: CorruptEntry[]; issues: ListIssue[]; degraded: boolean; scanned: number; complete: boolean };

export interface KvFolderLike {
  get(key: string): Promise<unknown>;
  set(key: string, v: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  update(key: string, updater: (before: unknown) => unknown): Promise<void>;
}

export interface DomainDef<T> {
  folder: string;
  schemaMajor: number;
  validate: (v: unknown) => v is T;
  displayLabel?: ((v: T) => string | null) | undefined;
}

function isThenable(x: unknown): boolean {
  return x !== null && (typeof x === 'object' || typeof x === 'function') && 'then' in (x as object) && typeof (x as { then?: unknown }).then === 'function';
}

function validateEnvelope(raw: unknown): { ok: boolean; reason?: CorruptEntry['reason'] } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'envelope' };
  const o = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(o['schemaMajor']) || (o['schemaMajor'] as number) < 1 || !Number.isSafeInteger(o['revision']) || (o['revision'] as number) < 1 || typeof o['deleted'] !== 'boolean' || !('value' in o)) return { ok: false, reason: 'envelope' };
  if (o['deleted'] === true && o['value'] !== null) return { ok: false, reason: 'envelope' };
  if (o['deleted'] !== true && (o['value'] === undefined || o['value'] === null)) return { ok: false, reason: 'envelope' };
  if ('origin' in o && o['origin'] !== undefined) {
    const orig=o['origin'];
    if(!orig||typeof orig!=='object')return {ok:false,reason:'envelope'};
    const a=orig as Record<string,unknown>;
    for(const name of ['attemptId','fileDigest','sourceDomain','sourceId','sourceRecordDigest'])if(typeof a[name]!=='string'||!a[name])return {ok:false,reason:'envelope'};
  }
  return { ok: true };
}

function cloneOrigin(o: ImportOrigin | undefined): ImportOrigin | undefined {
  if (o === undefined) return undefined;
  try { return structuredClone(o); } catch { return undefined; }
}

export class DraftStore<Domains extends Record<string, unknown>> {
  constructor(
    private readonly folders: (folder: string) => KvFolderLike,
    private readonly defs: { [D in keyof Domains & string]: DomainDef<Domains[D]> },
  ) {}

  domainDefinition<D extends keyof Domains & string>(domain: D): DomainDef<Domains[D]> { return this.def(domain); }

  private def<D extends keyof Domains & string>(domain: D): DomainDef<Domains[D]> {
    const rec = this.defs as Record<string, DomainDef<unknown>>;
    const d = rec[String(domain)];
    if (!d) throw new Error('UNKNOWN_DOMAIN:' + String(domain));
    return d as unknown as DomainDef<Domains[D]>;
  }

  async load<D extends keyof Domains & string>(domain: D, id: string): Promise<Outcome<StoredAggregate<Domains[D]> | null>> {
    if (!ID_RE.test(id)) return err('BAD_INPUT', 'bad id');
    const def = this.def(domain);
    const folder = this.folders(def.folder);
    let raw: unknown;
    try { raw = await folder.get(canonicalKey(id)); }
    catch { return err('STORE_UNAVAILABLE', 'load failed'); }
    if (raw === undefined) return ok(null);
    const env = validateEnvelope(raw);
    if (!env.ok) return err('STORE_CORRUPT', 'corrupt envelope');
    const agg = raw as StoredAggregate<Domains[D]>;
    if (agg.schemaMajor > def.schemaMajor) return err('SCHEMA_TOO_NEW', 'future major');
    if (!agg.deleted && agg.schemaMajor < def.schemaMajor) return err('SCHEMA_MIGRATION_REQUIRED', 'older major');
    if (agg.deleted) return ok({ schemaMajor: agg.schemaMajor, revision: agg.revision, deleted: true, value: null, ...(agg.origin !== undefined ? { origin: cloneOrigin(agg.origin) } : {}) });
    try {
      if (!def.validate(agg.value)) return err('STORE_CORRUPT', 'shape invalid');
    } catch { return err('STORE_CORRUPT', 'validator threw'); }
    return ok(structuredClone(agg));
  }

  // Atomic commit via single-key update(). Creation (expectedRevision null) requires
  // physically missing key inside the synchronous updater — never get()+set().
  async commit<D extends keyof Domains & string>(domain: D, id: string, expectedRevision: number | null, value: Domains[D]): Promise<Outcome<{ revision: number }>> {
    if (!ID_RE.test(id)) return err('BAD_INPUT', 'bad id');
    const def = this.def(domain);
    try { if (!def.validate(value)) return err('BAD_INPUT', 'invalid value'); }
    catch { return err('BAD_INPUT', 'validator threw'); }
    let clone: Domains[D];
    try { clone = structuredClone(value); } catch { return err('BAD_INPUT', 'not cloneable'); }
    const folder = this.folders(def.folder);
    const key = canonicalKey(id);
    let committedRevision: number | null = null;
    try {
      await folder.update(key, (before: unknown) => {
        if (before === undefined) {
          if (expectedRevision !== null) throw new Error('REVISION_CONFLICT:missing');
          const agg: StoredAggregate<Domains[D]> = { schemaMajor: def.schemaMajor, revision: 1, deleted: false, value: structuredClone(clone) };
          committedRevision = 1;
          return DraftStore.guardUpdater<StoredAggregate<Domains[D]>>(() => agg, undefined);
        }
        const bEnv = validateEnvelope(before);
        if (!bEnv.ok) throw new Error('STORE_CORRUPT:changed');
        const b = before as StoredAggregate<Domains[D]>;
        if (b.deleted) throw new Error('STORE_TOMBSTONE_CONFLICT');
        if (b.schemaMajor > def.schemaMajor) throw new Error('SCHEMA_TOO_NEW:future');
        if (b.schemaMajor !== def.schemaMajor) throw new Error('SCHEMA_MIGRATION_REQUIRED');
        if (expectedRevision !== b.revision) throw new Error('REVISION_CONFLICT:changed');
        const next: StoredAggregate<Domains[D]> = {
          schemaMajor: def.schemaMajor,
          revision: b.revision + 1,
          deleted: false,
          value: structuredClone(clone),
          ...(b.origin !== undefined ? { origin: cloneOrigin(b.origin) } : {}),
        };
        committedRevision = b.revision + 1;
        return DraftStore.guardUpdater<StoredAggregate<Domains[D]>>(() => next, b);
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('SCHEMA_TOO_NEW')) return err('SCHEMA_TOO_NEW', 'future major');
      if (msg.includes('REVISION_CONFLICT')) return err('REVISION_CONFLICT', 'concurrent change');
      if (msg.includes('STORE_TOMBSTONE_CONFLICT')) return err('STORE_TOMBSTONE_CONFLICT', 'tombstoned');
      if (msg.includes('SCHEMA_MIGRATION_REQUIRED')) return err('SCHEMA_MIGRATION_REQUIRED', 'major changed');
      if (msg.includes('STORE_CORRUPT')) return err('STORE_CORRUPT', 'corrupt current');
      if (msg.includes('UPDATER_MUST_RETURN')) return err('BAD_INPUT', 'updater invalid');
      return err('STORE_UNAVAILABLE', 'update failed');
    }
    if (committedRevision === null) return err('STORE_UNAVAILABLE', 'no commit');
    return ok({ revision: committedRevision });
  }

  async delete<D extends keyof Domains & string>(domain: D, id: string, expectedRevision: number): Promise<Outcome<{ revision: number }>> {
    if (!ID_RE.test(id)) return err('BAD_INPUT', 'bad id');
    const def = this.def(domain);
    const folder = this.folders(def.folder);
    const key = canonicalKey(id);
    let tombRevision: number | null = null;
    try {
      await folder.update(key, (before: unknown) => {
        if (before === undefined) throw new Error('REVISION_CONFLICT:missing');
        if (!validateEnvelope(before).ok) throw new Error('STORE_CORRUPT:changed');
        const b = before as StoredAggregate<Domains[D]>;
        if (b.deleted) throw new Error('STORE_TOMBSTONE_CONFLICT');
        if (b.schemaMajor > def.schemaMajor) throw new Error('SCHEMA_TOO_NEW:future');
        if (b.schemaMajor < def.schemaMajor) throw new Error('SCHEMA_MIGRATION_REQUIRED:older');
        if (b.revision !== expectedRevision) throw new Error('REVISION_CONFLICT:changed');
        try {
          if (!def.validate(b.value)) throw new Error('STORE_CORRUPT:shape');
        } catch (ex) {
          const m = String((ex as Error)?.message ?? ex);
          if (m.includes('STORE_CORRUPT')) throw ex;
          throw new Error('STORE_CORRUPT:validator');
        }
        const tomb: StoredAggregate<Domains[D]> = {
          schemaMajor: b.schemaMajor,
          revision: b.revision + 1,
          deleted: true,
          value: null,
          ...(b.origin !== undefined ? { origin: cloneOrigin(b.origin) } : {}),
        };
        tombRevision = b.revision + 1;
        return DraftStore.guardUpdater<StoredAggregate<Domains[D]>>(() => tomb, b);
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('SCHEMA_TOO_NEW')) return err('SCHEMA_TOO_NEW', 'future major');
      if (msg.includes('SCHEMA_MIGRATION_REQUIRED')) return err('SCHEMA_MIGRATION_REQUIRED', 'older major');
      if (msg.includes('REVISION_CONFLICT')) return err('REVISION_CONFLICT', 'concurrent');
      if (msg.includes('STORE_TOMBSTONE_CONFLICT')) return err('STORE_TOMBSTONE_CONFLICT', 'tombstoned');
      if (msg.includes('STORE_CORRUPT')) return err('STORE_CORRUPT', 'corrupt');
      return err('STORE_UNAVAILABLE', 'delete failed');
    }
    if (tombRevision === null) return err('STORE_UNAVAILABLE', 'no delete');
    return ok({ revision: tombRevision });
  }

  async list<D extends keyof Domains & string>(domain: D): Promise<Outcome<ListReport>> {
    const def = this.def(domain);
    const folder = this.folders(def.folder);
    let keys: string[];
    try { keys = await folder.keys(); } catch { return err('STORE_UNAVAILABLE', 'keys failed'); }
    const rKeys = keys.filter(k => k.startsWith('r/')).sort();
    const rawCount = rKeys.length;
    const SCAN_CAP = 5000;
    const LIVE_CAP = 500;
    const scannedKeys = rKeys.slice(0, SCAN_CAP);
    const summaries: ListedSummary[] = [];
    const corrupt: CorruptEntry[] = [];
    const needMigration: string[] = [];
    const tooNew: string[] = [];
    const corruptIds: string[] = [];
    for (let i = 0; i < scannedKeys.length; i += 25) {
      const chunk = scannedKeys.slice(i, i + 25);
      const vals: unknown[] = [];
      for (const k of chunk) {
        try { vals.push(await folder.get(k)); } catch { vals.push({__kvReadFailure:true}); }
      }
      for (let j = 0; j < chunk.length; j++) {
        const k = chunk[j];
        if (k === undefined) continue;
        const id = k.slice(2);
        const raw: unknown = j < vals.length ? vals[j] : undefined;
        if (raw === undefined) { corrupt.push({domain:String(domain),id,reason:'unreadable'});corruptIds.push(id);continue; }
        if(raw&&typeof raw==='object'&&'__kvReadFailure' in raw){corrupt.push({domain:String(domain),id,reason:'unreadable'});corruptIds.push(id);continue;}
        const env = validateEnvelope(raw);
        if (!env.ok) { corrupt.push({ domain: String(domain), id, reason: env.reason ?? 'envelope' }); corruptIds.push(id); continue; }
        const agg = raw as StoredAggregate<Domains[D]>;
        if (agg.deleted) continue;
        if (agg.schemaMajor < def.schemaMajor) { needMigration.push(id); continue; }
        if (agg.schemaMajor > def.schemaMajor) { tooNew.push(id); continue; }
        let valid = false;
        try { valid = def.validate(agg.value); } catch { valid = false; }
        if (!valid) { corrupt.push({ domain: String(domain), id, reason: 'shape' }); corruptIds.push(id); continue; }
        let label: string | null = null;
        try { label = def.displayLabel ? (def.displayLabel(agg.value as Domains[D]) ?? null) : null; } catch { label = null; }
        summaries.push({ id, revision: agg.revision, schemaMajor: agg.schemaMajor, displayLabel: label, updatedAt: null });
        if (summaries.length > LIVE_CAP) break;
      }
      if (summaries.length > LIVE_CAP) break;
    }
    const issues: ListIssue[] = [];
    if (rawCount > SCAN_CAP) issues.push({ code: 'STORE_SCAN_BUDGET', rawKeys: rawCount, scanCap: SCAN_CAP, scanned: scannedKeys.length });
    if (corruptIds.length) issues.push({ code: 'STORE_CORRUPT', ids: corruptIds.slice(0, 100), count: corruptIds.length });
    if (needMigration.length) issues.push({ code: 'SCHEMA_MIGRATION_REQUIRED', ids: needMigration.slice(0, 100), count: needMigration.length, currentMajor: def.schemaMajor });
    if (tooNew.length) issues.push({ code: 'SCHEMA_TOO_NEW', ids: tooNew.slice(0, 100), count: tooNew.length, currentMajor: def.schemaMajor });
    let outSummaries = summaries;
    if (summaries.length > LIVE_CAP) {
      outSummaries = summaries.slice(0, LIVE_CAP);
      issues.push({ code: 'STORE_TOO_MANY_RECORDS', liveCount: summaries.length, liveCap: LIVE_CAP });
    }
    const degraded = issues.length > 0;
    const complete = rawCount <= SCAN_CAP && issues.length === 0;
    return ok({ summaries: outSummaries, corrupt, issues, degraded, scanned: scannedKeys.length, complete });
  }

  // Guarded updater helper for native kv.update boundary: validates sync cloneable return BEFORE native call.
  static guardUpdater<T>(updater: (before: T | undefined) => T, before: T | undefined): T {
    let out: unknown;
    try { out = updater(before); } catch (e) { throw e; }
    if (out === undefined) throw new TypeError('UPDATER_MUST_RETURN_CLONEABLE_SYNCHRONOUS_VALUE');
    if (isThenable(out)) throw new TypeError('UPDATER_MUST_RETURN_CLONEABLE_SYNCHRONOUS_VALUE');
    try { structuredClone(out); } catch { throw new TypeError('UPDATER_MUST_RETURN_CLONEABLE_SYNCHRONOUS_VALUE'); }
    return out as T;
  }
}

// bindKv: selected-native-folder binding with dependency injection.
// Validates defs, requires a folder provider; never reports success when dep missing.
export function bindKv<Domains extends Record<string, unknown>>(
  root: unknown,
  defs: { [D in keyof Domains & string]: DomainDef<Domains[D]> },
  folderProvider?: (folder: string) => KvFolderLike,
): Outcome<DraftStore<Domains>> {
  try {
    for (const d of Object.values(defs as Record<string, DomainDef<unknown>>)) {
      if (!d || typeof d.folder !== 'string' || !d.folder || /\.\./.test(d.folder)) return err('BAD_INPUT', 'bad folder');
      if (typeof d.schemaMajor !== 'number' || typeof d.validate !== 'function') return err('BAD_INPUT', 'bad domain def');
    }
    if (folderProvider) {
      // Probe provider synchronously where possible: it must return folder-like for each def.
      try {
        for (const d of Object.values(defs as Record<string, DomainDef<unknown>>)) {
          const f = folderProvider(d.folder);
          if (!f || typeof f.get !== 'function' || typeof f.update !== 'function' || typeof f.keys !== 'function' || typeof f.set !== 'function' || typeof f.delete !== 'function') {
            return err('MISSING_BINDING', 'folder provider unusable for ' + d.folder);
          }
        }
      } catch {
        return err('MISSING_BINDING', 'folder provider threw');
      }
      return ok(new DraftStore<Domains>(folderProvider, defs));
    }
    // Native path: root.kv.<folder> must expose get/update/keys.
    const r = root as Record<string, unknown> | null | undefined;
    const kvRoot = r?.['kv'] as Record<string, unknown> | undefined;
    if (!kvRoot || typeof kvRoot !== 'object') return err('MISSING_BINDING', 'no native kv root');
    const folders = (folder: string): KvFolderLike => {
      const native = (kvRoot as Record<string, unknown>)[folder] as KvFolderLike | undefined;
      if (!native || typeof native.get !== 'function' || typeof native.update !== 'function' || typeof native.keys !== 'function' || typeof native.set !== 'function' || typeof native.delete !== 'function') {
        throw new Error('MISSING_BINDING:native folder missing for ' + folder);
      }
      return native;
    };
    // Validate each folder eagerly — never report success when essential dep missing.
    try {
      for (const d of Object.values(defs as Record<string, DomainDef<unknown>>)) {
        folders(d.folder);
      }
    } catch {
      return err('MISSING_BINDING', 'native folder missing or unusable');
    }
    return ok(new DraftStore<Domains>(folders, defs));
  } catch {
    return err('NATIVE_SYNC_THROW', 'bind failed');
  }
}
