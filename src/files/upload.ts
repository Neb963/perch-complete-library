// S3-20 FileTransferPort — optional upload, deletion custody stripped (v0.3.6 §22.8). Offline only; live upload held.
import { ok, err, unknown, type Outcome } from '../core/outcome.js';
export type PublicAttachment = { url: string; bytes: number; mediaType?: string };
export interface NativeUploadBackend { upload(data: string|Blob, opts?: {expires?: number}): Promise<{ url?: unknown; bytes?: unknown; mediaType?: unknown; error?: unknown; deletionUrl?: unknown }> }
export function bindUpload(backend: NativeUploadBackend | null) {
  async function upload(data: string|Blob, opts?: {expires?: number}): Promise<Outcome<PublicAttachment>> {
    if (!backend) return { kind:'unavailable', reason:'no backend' };
    if (typeof data !== 'string' && !(data instanceof Blob)) return err('BAD_INPUT','data');
    if (opts?.expires !== undefined && (typeof opts.expires !== 'number' || !(opts.expires>0))) return err('BAD_INPUT','expires');
    let raw: { url?: unknown; bytes?: unknown; mediaType?: unknown; error?: unknown; deletionUrl?: unknown };
    try { raw = await backend.upload(data, opts); }
    catch { return err('NATIVE_REJECTED','upload rejected'); }
    if (raw.error !== undefined && raw.error !== null && raw.error !== '') return err('NATIVE_REJECTED','service error');
    if (typeof raw.url !== 'string' || !raw.url.startsWith('https://')) return err('NATIVE_MALFORMED','bad url');
    // strip deletionUrl: never return, log, or persist it
    void (raw as {deletionUrl?:unknown}).deletionUrl;
    const bytes = typeof raw.bytes === 'number' ? raw.bytes : (typeof data==='string' ? new TextEncoder().encode(data).length : 0);
    const out: PublicAttachment = { url: raw.url, bytes };
    if (typeof raw.mediaType === 'string') out.mediaType = raw.mediaType;
    return ok(out);
  }
  return { upload };
}
