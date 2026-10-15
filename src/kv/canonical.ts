// S3-04 canonical JSON + hashes (v0.3.6 §22.7 exact wire format)
export function canonicalJson(v: unknown): string {
  return serialize(v, 0);
}
const MAX_DEPTH = 64;
const MAX_BYTES = 4 * 1024 * 1024;
function serialize(v: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new Error('DEPTH_LIMIT');
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('NON_FINITE_NUMBER');
    if (Object.is(v, -0)) throw new Error('NEGATIVE_ZERO');
    return JSON.stringify(v) as string;
  }
  if (typeof v === 'string') {
    // reject unpaired surrogates
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const n = v.charCodeAt(i+1);
        if (!(n >= 0xdc00 && n <= 0xdfff)) throw new Error('UNPAIRED_SURROGATE');
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('UNPAIRED_SURROGATE');
    }
    return JSON.stringify(v) as string;
  }
  if (Array.isArray(v)) {
    const parts = v.map(el => serialize(el, depth+1));
    const out = '[' + parts.join(',') + ']';
    if (out.length > MAX_BYTES) throw new Error('SIZE_LIMIT');
    return out;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    // duplicate keys impossible in JS objects; validate every key scalar
    for (const k of keys) {
      for (let i = 0; i < k.length; i++) {
        const c = k.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const n = k.charCodeAt(i+1);
          if (!(n >= 0xdc00 && n <= 0xdfff)) throw new Error('UNPAIRED_SURROGATE_KEY');
          i++;
        } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('UNPAIRED_SURROGATE_KEY');
      }
    }
    // Unicode code-point ordering (not numeric-aware)
    const sorted = [...keys].sort((a,b) => {
      const aa=Array.from(a,ch=>ch.codePointAt(0)!);
      const bb=Array.from(b,ch=>ch.codePointAt(0)!);
      for(let i=0;i<Math.min(aa.length,bb.length);i++) {
        if(aa[i]!==bb[i])return aa[i]! - bb[i]!;
      }
      return aa.length - bb.length;
    });
    const parts = sorted.map(k => JSON.stringify(k) + ':' + serialize(obj[k], depth+1));
    const out = '{' + parts.join(',') + '}';
    if (out.length > MAX_BYTES) throw new Error('SIZE_LIMIT');
    return out;
  }
  throw new Error('UNJSONABLE_TYPE:' + typeof v);
}

export async function sha256HexUtf8(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function H_sync_placeholder(): never { throw new Error('use async sha'); }

// H(tag,...fields) = SHA-256 hex over UTF-8 of tag + '\n' + concat(byteLen+':'+field)
// Async (WebCrypto outside kv.update callback).
export async function H(tag: string, ...fields: string[]): Promise<string> {
  let acc = tag + '\n';
  for (const f of fields) {
    const len = new TextEncoder().encode(f).length;
    acc += len + ':' + f;
  }
  return sha256HexUtf8(acc);
}

// Sync FNV-ish fallback for inside-callback snapshot equality? No crypto inside callback.
// For digest precomputed outside, we just compare canonical strings.
export function canonicalEqual(a: unknown, b: unknown): boolean {
  try { return canonicalJson(a) === canonicalJson(b); } catch { return false; }
}
