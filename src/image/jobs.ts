// S3-09 image job collection CAS (jobs/r/local-history singleton, §22.5)
// One authoritative schema, single-key CAS with bounded reread/rebase retries.
import { ok, err, type Outcome } from '../core/outcome.js';
import type { KvFolderLike } from '../kv/store.js';

export type ImageJobRecord = { id: string; prompt: string; parameters: Record<string, string | number | boolean | null>; createdAt: string; mode: 'data' | 'tile'; resultKind: 'pending' | 'available' | 'unknown' | 'failed'; originSessionId: string; remoteUrl?: string | undefined; favorite: boolean };
export type JobCollection = { id: 'local-history'; jobs: ImageJobRecord[] };

const MAX_JOBS = 200;
const SINGLETON_KEY = 'r/local-history';
const SCHEMA_MAJOR = 1;

type Agg = { schemaMajor: number; revision: number; deleted: boolean; value: JobCollection | null };

function readCollection(raw: unknown): { coll: JobCollection; revision: number } | null {
  if (raw === undefined) return { coll: { id: 'local-history', jobs: [] }, revision: 0 };
  if (raw === null || typeof raw !== 'object') return null;
  const agg = raw as Record<string, unknown>;
  // Do not silently reinterpret a tombstone, future-major envelope, or malformed
  // raw object as an empty collection: this would erase history on the next CAS.
  if (agg['schemaMajor'] !== SCHEMA_MAJOR || !Number.isSafeInteger(agg['revision']) || (agg['revision'] as number) < 1 || agg['deleted'] !== false) return null;
  const value=agg['value'];
  if (!value || typeof value !== 'object') return null;
  const v=value as {id?:unknown;jobs?:unknown};
  if (v.id !== 'local-history' || !Array.isArray(v.jobs) || v.jobs.length > MAX_JOBS) return null;
  const seen=new Set<string>();
  for (const j of v.jobs) {
    if (!j || typeof j!=='object' || typeof j.id!=='string' || !j.id || seen.has(j.id) ||
        typeof j.prompt!=='string' || !['pending','available','unknown','failed'].includes(j.resultKind) ||
        typeof j.favorite!=='boolean') return null;
    seen.add(j.id);
  }
  return { coll: { id:'local-history', jobs: [...v.jobs] as ImageJobRecord[] },revision:agg['revision'] as number };
}

export class JobStore {
  constructor(private readonly folder: KvFolderLike, private readonly sessionId: string) {}

  private newId(prefix: string): string {
    return prefix + '-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  async reserve(prompt: string, mode: 'data' | 'tile', params: Record<string, string | number | boolean | null>): Promise<Outcome<{ jobId: string }>> {
    if (typeof prompt !== 'string' || !prompt.trim()) return err('BAD_INPUT', 'prompt');
    if (prompt.length > 2000) return err('BAD_INPUT', 'prompt too long');
    let clonedParams: Record<string, string | number | boolean | null>;
    try { clonedParams = structuredClone(params); } catch { return err('BAD_INPUT', 'params'); }
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try { raw = await this.folder.get(SINGLETON_KEY); } catch { return err('STORE_UNAVAILABLE', 'read'); }
      const parsed = readCollection(raw);
      if (!parsed) return err('STORE_CORRUPT', 'collection corrupt');
      const jobs = [...parsed.coll.jobs];
      const unsettled = jobs.filter(j => j.resultKind === 'pending' || j.resultKind === 'unknown').length;
      const fav = jobs.filter(j => j.favorite).length;
      void unsettled; void fav;
      if (jobs.length >= MAX_JOBS) {
        // Evict only confirmed-settled non-favorite; never pending/unknown/favorite.
        const idx = jobs.findIndex(j => (j.resultKind === 'available' || j.resultKind === 'failed') && !j.favorite);
        if (idx === -1) return err('STORE_QUOTA', 'no evictable job');
        jobs.splice(idx, 1);
      }
      const jobId = this.newId('job');
      if (jobs.some(j=>j.id===jobId)) continue;
      const rec: ImageJobRecord = { id: jobId, prompt, parameters: clonedParams, createdAt: new Date().toISOString(), mode, resultKind: 'pending', originSessionId: this.sessionId, favorite: false };
      jobs.push(rec);
      const next: JobCollection = { id: 'local-history', jobs };
      const expectRev = parsed.revision;
      try {
        await this.folder.update(SINGLETON_KEY, (before: unknown) => {
          const bParsed = readCollection(before);
          if (!bParsed) throw new Error('STORE_CORRUPT:changed');
          if (bParsed.revision !== expectRev) throw new Error('REVISION_CONFLICT:changed');
          if (bParsed.coll.jobs.some(j => j.id === jobId)) throw new Error('REVISION_CONFLICT:duplicate');

          const agg: Agg = { schemaMajor: SCHEMA_MAJOR, revision: expectRev + 1, deleted: false, value: next };
          return structuredClone(agg);
        });
        return ok({ jobId });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (msg.includes('STORE_QUOTA')) return err('STORE_QUOTA', 'history full');
        if (msg.includes('STORE_CORRUPT')) return err('STORE_CORRUPT', 'corrupt');
        if (attempt === 2) return err('REVISION_CONFLICT', 'conflict');
        // retry with reread/rebase
      }
    }
    return err('REVISION_CONFLICT', 'conflict');
  }

  async complete(jobId: string, resultKind: 'available' | 'failed' | 'unknown', remoteUrl?: string): Promise<Outcome<void>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try { raw = await this.folder.get(SINGLETON_KEY); } catch { return err('STORE_UNAVAILABLE', 'read'); }
      const parsed = readCollection(raw);
      if (!parsed) return err('STORE_CORRUPT', 'corrupt');
      const idx = parsed.coll.jobs.findIndex(j => j.id === jobId);
      if (idx === -1) return err('REVISION_CONFLICT', 'missing job');
      const cur = parsed.coll.jobs[idx];
      if (!cur) return err('REVISION_CONFLICT', 'missing job');
      if (cur.resultKind !== 'pending') return err('REVISION_CONFLICT', 'already terminal');
      const next = { ...cur, resultKind } as ImageJobRecord;
      if (remoteUrl !== undefined) next.remoteUrl = remoteUrl;
      const jobs = [...parsed.coll.jobs];
      jobs[idx] = next;
      const expectRev = parsed.revision;
      try {
        await this.folder.update(SINGLETON_KEY, (before: unknown) => {
          const b = readCollection(before);
          if (!b) throw new Error('STORE_CORRUPT:changed');
          if (b.revision !== expectRev) throw new Error('REVISION_CONFLICT:changed');
          const bi = b.coll.jobs.findIndex(j => j.id === jobId);
          if (bi === -1) throw new Error('REVISION_CONFLICT:missing');
          const bc = b.coll.jobs[bi];
          if (!bc || bc.resultKind !== 'pending') throw new Error('REVISION_CONFLICT:terminal');
          const nj = [...b.coll.jobs];
          nj[bi] = structuredClone(next);
          const agg: Agg = { schemaMajor: SCHEMA_MAJOR, revision: expectRev + 1, deleted: false, value: { id: 'local-history', jobs: nj } };
          return structuredClone(agg);
        });
        return ok(undefined);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (msg.includes('REVISION_CONFLICT')) {
          if (attempt === 2) return err('REVISION_CONFLICT', 'conflict');
          continue;
        }
        if (msg.includes('STORE_CORRUPT')) return err('STORE_CORRUPT', 'corrupt');
        return err('STORE_UNAVAILABLE', 'write');
      }
    }
    return err('REVISION_CONFLICT', 'conflict');
  }

  async setFavorite(jobId: string, favorite: boolean): Promise<Outcome<void>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try { raw = await this.folder.get(SINGLETON_KEY); } catch { return err('STORE_UNAVAILABLE', 'read'); }
      const parsed = readCollection(raw);
      if (!parsed) return err('STORE_CORRUPT', 'corrupt');
      const idx = parsed.coll.jobs.findIndex(j => j.id === jobId);
      if (idx === -1) return err('REVISION_CONFLICT', 'missing job');
      const jobs = [...parsed.coll.jobs];
      const cur = jobs[idx];
      if (!cur) return err('REVISION_CONFLICT', 'missing');
      jobs[idx] = { ...cur, favorite };
      const expectRev = parsed.revision;
      try {
        await this.folder.update(SINGLETON_KEY, (before: unknown) => {
          const b = readCollection(before);
          if (!b) throw new Error('STORE_CORRUPT:changed');
          if (b.revision !== expectRev) throw new Error('REVISION_CONFLICT:changed');
          const nj = [...b.coll.jobs];
          const bi = nj.findIndex(j => j.id === jobId);
          if (bi === -1) throw new Error('REVISION_CONFLICT:missing');
          const bc = nj[bi];
          if (!bc) throw new Error('REVISION_CONFLICT:missing');
          nj[bi] = { ...bc, favorite };
          return structuredClone({ schemaMajor: SCHEMA_MAJOR, revision: expectRev + 1, deleted: false, value: { id: 'local-history', jobs: nj } } as Agg);
        });
        return ok(undefined);
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes('REVISION_CONFLICT')) {
          if (attempt === 2) return err('REVISION_CONFLICT', 'conflict');
          continue;
        }
        return err('STORE_UNAVAILABLE', 'write');
      }
    }
    return err('REVISION_CONFLICT', 'conflict');
  }

  async remove(jobId: string): Promise<Outcome<void>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: unknown;
      try { raw = await this.folder.get(SINGLETON_KEY); } catch { return err('STORE_UNAVAILABLE', 'read'); }
      const parsed = readCollection(raw);
      if (!parsed) return err('STORE_CORRUPT', 'corrupt');
      if (!parsed.coll.jobs.some(j => j.id === jobId)) return err('REVISION_CONFLICT', 'missing job');
      const expectRev = parsed.revision;
      try {
        await this.folder.update(SINGLETON_KEY, (before: unknown) => {
          const b = readCollection(before);
          if (!b) throw new Error('STORE_CORRUPT:changed');
          if (b.revision !== expectRev) throw new Error('REVISION_CONFLICT:changed');
          const nj = b.coll.jobs.filter(j => j.id !== jobId);
          if (nj.length === b.coll.jobs.length) throw new Error('REVISION_CONFLICT:missing');
          return structuredClone({ schemaMajor: SCHEMA_MAJOR, revision: expectRev + 1, deleted: false, value: { id: 'local-history', jobs: nj } } as Agg);
        });
        return ok(undefined);
      } catch (e) {
        if (String((e as Error)?.message ?? e).includes('REVISION_CONFLICT')) {
          if (attempt === 2) return err('REVISION_CONFLICT', 'conflict');
          continue;
        }
        return err('STORE_UNAVAILABLE', 'write');
      }
    }
    return err('REVISION_CONFLICT', 'conflict');
  }

  async load(): Promise<Outcome<JobCollection>> {
    let raw: unknown;
    try { raw = await this.folder.get(SINGLETON_KEY); } catch { return err('STORE_UNAVAILABLE', 'read'); }
    const parsed = readCollection(raw);
    if (!parsed) return err('STORE_CORRUPT', 'corrupt');
    return ok(structuredClone(parsed.coll));
  }
}
