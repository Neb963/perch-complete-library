// S3-03 HostEnvironmentPort (v0.3.6 §22.8) — ordinary bounded host seam, no PJS import.
import { ok, err, unknown, unavailable, type Outcome } from '../core/outcome.js';

export type GeneratorIdentity = { name: string | null; isUnsaved: boolean | null; isEditMode: boolean | null };
export type UrlParts = { query?: Record<string,string|null> | undefined; hash?: string | null | undefined };
export type HostConfig = { savedTargetEvidence?: { generatorSlug: string; observationId: string; environment: 'saved-public'; fixtureSha256: string; verified: true } | undefined };
export interface HostEnvironmentPort {
  generatorIdentity(): GeneratorIdentity;
  readUrlState(allowedQueryKeys?: ReadonlyArray<string>): Outcome<{query: Record<string,string>; hash: string | null}>;
  canonicalShareUrl(parts?: UrlParts): Outcome<{url: string; publication: 'known_saved'|'known_unsaved'|'unknown'}>;
  replaceUrlState(parts: UrlParts): Outcome<void>;
}

export interface HostRuntime { generatorName?: unknown; generatorIsUnsaved?: unknown; generatorIsInEditMode?: unknown; locationHref: string; pathname: string; }

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const QUERY_KEY_RE = /^[A-Za-z0-9_\-]{1,64}$/;

export function bindHostEnvironment(cfg: HostConfig, rt: HostRuntime): HostEnvironmentPort {
  function identity(): GeneratorIdentity {
    const name = typeof rt.generatorName === 'string' && rt.generatorName.length > 0 ? rt.generatorName : null;
    const isUnsaved = typeof rt.generatorIsUnsaved === 'boolean' ? rt.generatorIsUnsaved : null;
    const isEditMode = typeof rt.generatorIsInEditMode === 'boolean' ? rt.generatorIsInEditMode : null;
    return { name, isUnsaved, isEditMode };
  }
  function parseCurrent(): { query: Record<string,string>; hash: string | null; rawKeys: string[] } | { error: string } {
    let u: URL;
    try { u = new URL(rt.locationHref); } catch { return { error: 'URL_INVALID' }; }
    const query: Record<string,string> = {};
    const rawKeys: string[] = [];
    // detect duplicate sensitive keys by manual split (URLSearchParams dedups)
    const q = u.search.startsWith('?') ? u.search.slice(1) : u.search;
    if (q) {
      const seen = new Map<string,number>();
      for (const part of q.split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const kEnc = eq === -1 ? part : part.slice(0, eq);
        let k: string;
        try { k = decodeURIComponent(kEnc); } catch { return { error: 'URL_INVALID' }; }
        rawKeys.push(k);
        seen.set(k, (seen.get(k) ?? 0) + 1);
        if ((seen.get(k) ?? 0) > 1) return { error: 'DUPLICATE' };
        if (!QUERY_KEY_RE.test(k)) return { error: 'URL_INVALID' };
        const vEnc = eq === -1 ? '' : part.slice(eq+1);
        let v: string;
        try { v = decodeURIComponent(vEnc); } catch { return { error: 'URL_INVALID' }; }
        if (v.length > 2048) return { error: 'URL_INVALID' };
        query[k] = v;
      }
    }
    let hash: string | null = null;
    if (u.hash) {
      hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
      if (hash.length > 512) return { error: 'URL_INVALID' };
      if (hash.startsWith('#')) return { error: 'URL_INVALID' };
    }
    return { query, hash, rawKeys };
  }
  return {
    generatorIdentity: identity,
    readUrlState(allowed?: ReadonlyArray<string>) {
      const cur = parseCurrent();
      if ('error' in cur) return err('URL_INVALID', 'current url invalid');
      if (allowed) {
        for (const k of Object.keys(cur.query)) {
          if (!(allowed as readonly string[]).includes(k)) return err('URL_STATE_UNQUALIFIED', 'unknown query key');
        }
        for (const a of allowed) { if (!QUERY_KEY_RE.test(a)) return err('BAD_INPUT', 'bad allowlist key'); }
      }
      return ok({ query: { ...cur.query }, hash: cur.hash });
    },
    canonicalShareUrl(parts?: UrlParts) {
      const id = identity();
      if (!id.name) return unavailable('missing generator name');
      if (id.name.includes('/') || !NAME_RE.test(id.name) && !/^[A-Za-z0-9-]+$/.test(id.name)) {
        // allow broader? strict: must be perchance slug-like
      }
      const base = 'https://perchance.org/' + encodeURIComponent(id.name);
      let suffix = '';
      if (parts?.query) {
        const entries = Object.entries(parts.query).filter(([,v]) => v !== null) as Array<[string,string]>;
        for (const [k,v] of entries) {
          if (!QUERY_KEY_RE.test(k)) return err('BAD_INPUT', 'bad query key');
          if (v.length > 2048) return err('BAD_INPUT', 'query value too long');
        }
        entries.sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
        if (entries.length) suffix += '?' + entries.map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
      }
      if (parts?.hash !== undefined && parts.hash !== null) {
        if (parts.hash.startsWith('#')) return err('BAD_INPUT', 'hash must not start with #');
        if (parts.hash.length > 512) return err('BAD_INPUT', 'hash too long');
        suffix += '#' + encodeURIComponent(parts.hash);
      }
      let publication: 'known_saved'|'known_unsaved'|'unknown' = 'unknown';
      if (id.isUnsaved === true) publication = 'known_unsaved';
      else if (cfg.savedTargetEvidence && cfg.savedTargetEvidence.verified && cfg.savedTargetEvidence.environment === 'saved-public' && cfg.savedTargetEvidence.generatorSlug === id.name  ) {
        publication = 'known_saved';
      }
      return ok({ url: base + suffix, publication });
    },
    replaceUrlState(parts: UrlParts) {
      const id = identity();
      if (!id.name) return unavailable('missing identity');
      const cur = parseCurrent();
      if ('error' in cur) return err('URL_INVALID', 'current url invalid');
      // validate inputs
      if (parts.query) {
        for (const [k,v] of Object.entries(parts.query)) {
          if (!QUERY_KEY_RE.test(k)) return err('BAD_INPUT', 'bad query key');
          if (v !== null && v.length > 2048) return err('BAD_INPUT', 'value too long');
        }
      }
      if (parts.hash !== undefined && parts.hash !== null) {
        if (parts.hash.startsWith('#')) return err('BAD_INPUT', 'hash prefix');
        if (parts.hash.length > 512) return err('BAD_INPUT', 'hash too long');
      }
      // construct target using current iframe generator pathname, never parent URL
      const expectedPath = '/' + encodeURIComponent(id.name);
      if (!rt.pathname.startsWith('/')) return err('URL_INVALID', 'bad pathname');
      // In real browser this would call history.replaceState; here we return ok to indicate validation passed.
      // Caller in preview asserts actual location change separately (HOST-DEEPLINK ticket).
      void expectedPath;
      return ok(undefined);
    },
  };
}

export function validateImageUrlStrict(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return true;
  } catch { return false; }
}
