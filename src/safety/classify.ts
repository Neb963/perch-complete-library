// S3-21 ClassificationPort + safety.protectedUsers (conditional, offline; CORS UNQUALIFIED hold).
export type Classification =
  | { kind:'tags'; tags:string[]; source:'imageTags'|'fileInfo' }
  | { kind:'invalid'|'unsupported'|'unknown'; reason:string };

export function normalizeHostedMedia(url: string): { ok: boolean; canonical?: string | undefined; endpoint?: string | undefined; reason?: string | undefined } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok:false, reason:'invalid' }; }
  if (u.protocol!=='https:') return { ok:false, reason:'invalid' };
  if (u.username || u.password) return { ok:false, reason:'invalid' };
  if (u.hash && u.hash !== '') { /* fragments with unexpected meaning rejected unless empty */ return { ok:false, reason:'invalid' }; }
  const host = u.hostname.toLowerCase();
  // aigc image: https://aigc.uploads.dev/image/<64 hex>.<ext>
  let m = /^\/image\/([0-9a-f]{64})\.(jpg|jpeg|png|webp)$/.exec(u.pathname);
  if (host==='aigc.uploads.dev' && m) {
    const h1: string | undefined = m[1];
    const h2: string | undefined = m[2];
    if (h1 === undefined || h2 === undefined) return { ok:false, reason:'invalid' };
    const canonical = 'https://aigc.uploads.dev/image/' + h1 + '.' + h2;
    return { ok:true, canonical, endpoint:'https://image-generation.perchance.org/api/imageTags?url=' + encodeURIComponent(canonical) };
  }
  // user file: https://user.uploads.dev/file/<safe-id>
  if (host==='user.uploads.dev') {
    const fm = /^\/file\/([A-Za-z0-9._-]{1,256})$/.exec(u.pathname);
    if (!fm || u.pathname.includes('..')) return { ok:false, reason:'invalid' };
    const fid: string | undefined = fm[1];
    if (fid === undefined) return { ok:false, reason:'invalid' };
    if (u.search || u.hash) { /* remove safe query/hash after parsing */ }
    const canonical = 'https://user.uploads.dev/file/' + fid;
    return { ok:true, canonical, endpoint:'https://upload.perchance.org/api/fileInfo?url=' + encodeURIComponent(canonical) };
  }
  if (host==='editable.uploads.dev') return { ok:false, reason:'unsupported' };
  return { ok:false, reason:'unsupported' };
}

export async function classifyHostedMedia(url: string, fetchJson: (endpoint:string)=>Promise<{status:number; body:unknown}>): Promise<Classification> {
  const n = normalizeHostedMedia(url);
  if (!n.ok) {
    if (n.reason==='invalid') return { kind:'invalid', reason:'invalid_image_url' };
    return { kind:'unsupported', reason:'unsupported host' };
  }
  let res: {status:number; body:unknown};
  try { res = await fetchJson(n.endpoint as string); }
  catch { return { kind:'unknown', reason:'network' }; }
  const body = res.body as Record<string,unknown> | null;
  if (body && typeof body === 'object' && (body as {error?:unknown}).error === 'invalid_image_url') return { kind:'invalid', reason:'invalid_image_url' };
  if (res.status===404 || (body && (body as {error?:unknown}).error==='not_found')) return { kind:'unknown', reason:'not_found' };
  if (res.status===429 || res.status>=500 || (body && (body as {error?:unknown}).error==='server_error')) return { kind:'unknown', reason:'server_error' };
  if (res.status>=200 && res.status<300 && body && Array.isArray((body as {tags?:unknown}).tags)) {
    const tags = ((body as {tags:unknown[]}).tags.filter((t):t is string=>typeof t==='string'));
    const source = (n.endpoint as string).includes('imageTags') ? 'imageTags' as const : 'fileInfo' as const;
    return { kind:'tags', tags, source };
  }
  return { kind:'unknown', reason:'malformed' };
}

// safety.protectedUsers gating: fail-closed — unknown/invalid never clearance
export function gateProtectedUsers(classification: Classification): { allow:boolean; reason:string } {
  if (classification.kind==='tags') {
    if (classification.tags.includes('nsfw')) return { allow:false, reason:'flagged' };
    return { allow:true, reason:'no tags' };
  }
  return { allow:false, reason:'fail-closed:'+classification.kind };
}
