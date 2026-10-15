// S3-06 bindText — single normalization seam (v0.3.6 §22.4). No queue here; scheduler owns dispatch.
import { ok, err, unknown, type Outcome } from '../core/outcome.js';
import { truncateStop, projectStream, stripPrefix, type PrefixVisibility } from './normalize.js';

export type TextInstruction = string | Array<string | Blob | File>;
export type TextMetadata = { countTokens(text: string): number; idealMaxContextTokens: number };
export type TextOptions = { instruction: TextInstruction; startWith?: string | undefined; stopSequences?: string[] | undefined; prefixVisibility?: PrefixVisibility | undefined };
export type TextChunk = { appendedText: string; fullVisibleText: string; fromPrefix: boolean };
export type TextFinal = { generatedText: string; visibleText: string };
export type TextRequest = { operationId: string; completion: Promise<Outcome<TextFinal>>; requestStop(): Outcome<{stopInvoked:boolean}>; detachView(): void };

// Native shape (minimal, String-like hybrid)
export interface NativeTextLike {
  // biome-ignore: native hybrid has custom then?
  [k: string]: unknown;
  generatedText?: unknown;
  text?: unknown;
  textChunk?: unknown;
  fullTextSoFar?: unknown;
  isFromStartWith?: unknown;
}

export interface NativeBackend {
  metadata(): { countTokens(text: string): number; idealMaxContextTokens: number };
  // startNative mimics generateText: returns hybrid with .stop() + promise-like + callbacks
  startNative(opts: { instruction: unknown; startWith?: string | undefined; stopSequences?: string[] | undefined }, hooks: {
    onChunk?: (c: { textChunk: string; fullTextSoFar: string; isFromStartWith: boolean }) => void;
    onFinish?: (r: { generatedText?: unknown; text?: unknown }) => void;
  }): { hybrid: { stop?: () => void }; promise: Promise<unknown> };
}

let opCounter = 0;

export function bindText(backend: NativeBackend | null, diag?: (d: {code:string; operationId?:string})=>void) {
  function metadata(): Outcome<TextMetadata> {
    if (!backend) return { kind: 'unavailable', reason: 'no backend' };
    try {
      const m = backend.metadata();
      if (typeof m.countTokens !== 'function' || typeof m.idealMaxContextTokens !== 'number') return err('NATIVE_MALFORMED', 'bad metadata');
      return ok({ countTokens: (t: string) => { try { return m.countTokens(t); } catch { return Math.ceil(t.length/4); } }, idealMaxContextTokens: m.idealMaxContextTokens });
    } catch {
      return err('NATIVE_SYNC_THROW', 'metadata throw');
    }
  }

  function start(opts: TextOptions, hooks?: { onChunk?: (c: TextChunk)=>void }): Outcome<TextRequest> {
    const operationId = 'txt-' + (++opCounter) + '-' + Date.now().toString(36);
    // input validation
    if (typeof opts.instruction !== 'string' && !Array.isArray(opts.instruction)) return err('BAD_INPUT', 'bad instruction');
    if (Array.isArray(opts.instruction)) {
      let images = 0;
      for (const part of opts.instruction) {
        if (typeof part === 'string') continue;
        if ((typeof Blob !== 'undefined' && part instanceof Blob) || (typeof File !== 'undefined' && part instanceof File)) { images++; continue; }
        return err('BAD_INPUT', 'bad instruction part');
      }
      if (images > 1) return err('BAD_INPUT', 'at most one image');
    }
    const stops = opts.stopSequences ?? [];
    try {
      if (stops.length > 16) return err('TEXT_DISPATCH_LIMIT', 'too many stops');
      for (const s of stops) { if (typeof s !== 'string' || !s || [...s].length > 128) return err('BAD_INPUT', 'bad stop'); }
      if (new Set(stops).size !== stops.length) return err('BAD_INPUT', 'duplicate stop');
    } catch { return err('BAD_INPUT', 'stop validation'); }
    const visibility: PrefixVisibility = opts.prefixVisibility ?? 'hidden';
    const requestedStart = opts.startWith;
    if (!backend) return { kind: 'unavailable', reason: 'no backend' };

    let detached = false;
    let viewVisible = '';
    let hadStop = false;
    let verifiedPrefix = '';
    let prefixChecked = false;
    let settled = false;
    let nativeStop: (()=>void) | null = null;

    let resolveCompletion!: (o: Outcome<TextFinal>) => void;
    const completion = new Promise<Outcome<TextFinal>>((res)=>{ resolveCompletion = res; });
    function finish(o: Outcome<TextFinal>): void {
      if (settled) return;
      settled = true;
      resolveCompletion(o);
    }

    let hybrid: { stop?: ()=>void } | null = null;
    let nativePromise: Promise<unknown> | null = null;
    try {
      const started = backend.startNative({ instruction: opts.instruction, startWith: opts.startWith, stopSequences: stops }, {
        onChunk: (c) => {
          if (detached || settled) return; // late callback fenced to originating view; detached view ignores
          try {
            const full = String(c.fullTextSoFar ?? '');
            const chunkIsPrefix = !!c.isFromStartWith;
            // derive prefix once
            if (!prefixChecked && requestedStart) {
              const stripped = stripPrefix(full, '', chunkIsPrefix, requestedStart);
              if (!stripped.prefixOk) {
                // TEXT_PREFIX_MISMATCH: suppress hidden-prefix-bearing output
                try { hooks?.onChunk?.({ appendedText: '', fullVisibleText: viewVisible, fromPrefix: false }); } catch {}
                finish(err('TEXT_PREFIX_MISMATCH', 'prefix mismatch'));
                return;
              }
              verifiedPrefix = stripped.actualPrefix;
              prefixChecked = true;
              const gen = stripped.generated;
              const proj = projectStream(gen, '', stops, hadStop);
              hadStop = proj.stopped;
              viewVisible = visibility === 'visible' ? verifiedPrefix + proj.visible : proj.visible;
              try { hooks?.onChunk?.({ appendedText: proj.appended, fullVisibleText: viewVisible, fromPrefix: chunkIsPrefix }); } catch {
                // callback throw => TEXT_STOP_THROW? per contract stop throw distinct; here chunk throw is app error, fence
                diag?.({code:'TEXT_STOP_THROW', operationId});
              }
              return;
            }
            let gen = full;
            if (requestedStart) {
              if (!prefixChecked) {
                // no isFromStartWith seen yet: use archived normalization
                const stripped = stripPrefix(full, '', false, requestedStart);
                if (!stripped.prefixOk) {
                  finish(err('TEXT_PREFIX_MISMATCH', 'prefix mismatch'));
                  return;
                }
                verifiedPrefix = stripped.actualPrefix;
                prefixChecked = true;
                gen = stripped.generated;
              } else {
                gen = full.startsWith(verifiedPrefix) ? full.slice(verifiedPrefix.length) : full;
                // if full is cumulative including prefix, strip; else assume already generated-only
                if (full.startsWith(verifiedPrefix)) gen = full.slice(verifiedPrefix.length);
                else gen = full;
              }
            }
            const proj = projectStream(gen, visibility === 'visible' && viewVisible.startsWith(verifiedPrefix) ? viewVisible.slice(verifiedPrefix.length) : viewVisible, stops, hadStop);
            hadStop = proj.stopped;
            const newVisible = visibility === 'visible' ? verifiedPrefix + proj.visible : proj.visible;
            // stopped clamp: never re-expose after marker
            if (hadStop && newVisible.length > viewVisible.length && !newVisible.startsWith(viewVisible)) {
              // divergent after stop: keep prior
              try { hooks?.onChunk?.({ appendedText: '', fullVisibleText: viewVisible, fromPrefix: chunkIsPrefix }); } catch {}
              return;
            }
            const appended = newVisible.startsWith(viewVisible) ? newVisible.slice(viewVisible.length) : '';
            viewVisible = newVisible;
            try { hooks?.onChunk?.({ appendedText: appended, fullVisibleText: viewVisible, fromPrefix: chunkIsPrefix }); } catch {}
          } catch {
            finish(err('TEXT_STOP_THROW', 'chunk handler failed'));
          }
        },
        onFinish: (r) => {
          if (settled) return;
          if (detached) {
            // late result belongs to original op, not selected view: settle as unknown? per contract late belongs to orig op — we still settle orig completion
          }
          try {
            const raw = r?.generatedText;
            if (typeof raw !== 'string') {
              finish(err('TEXT_MALFORMED_FINAL', 'missing generatedText'));
              return;
            }
            let gen = raw;
            if (requestedStart) {
              const norm = requestedStart.replace(/ +$/, '');
              if (!prefixChecked) {
                // No chunks observed (zero-chunk / final-only): accept either prefixed or already-generated final.
                // Prefer the full requested prefix (with trailing spaces) so 'Bob: hello' → 'hello', not ' hello'.
                if (requestedStart.length > 0 && raw.startsWith(requestedStart)) {
                  gen = raw.slice(requestedStart.length);
                  verifiedPrefix = requestedStart;
                } else if (norm.length > 0 && raw.startsWith(norm)) {
                  gen = raw.slice(norm.length);
                  // If norm matched but full did not, the remainder may start with spaces from the original
                  // requested trailing-space gap (e.g. 'Bob: hello' vs norm 'Bob:'); trim one gap space.
                  if (gen.startsWith(' ') && requestedStart.endsWith(' ')) gen = gen.slice(1);
                  verifiedPrefix = requestedStart;
                } else {
                  // Treat as already-generated (prefix consumed natively or never echoed).
                  gen = raw;
                  verifiedPrefix = requestedStart;
                }
                prefixChecked = true;
              } else {
                if (verifiedPrefix.length > 0 && gen.startsWith(verifiedPrefix)) gen = gen.slice(verifiedPrefix.length);
                else if (norm.length > 0 && gen.startsWith(norm)) {
                  gen = gen.slice(norm.length);
                  if (gen.startsWith(' ') && requestedStart.endsWith(' ')) gen = gen.slice(1);
                }
                // else: final already generated-only; keep as-is (do not force prefix).
              }
            }
            const t = truncateStop(gen, stops);
            const generatedText = t.text;
            // stream/final mismatch: if stream observed stop but final contradicts (earlier prefix differs or omits marker and adds different content)
            if (hadStop) {
              const streamVisible = visibility === 'visible' && viewVisible.startsWith(verifiedPrefix) ? viewVisible.slice(verifiedPrefix.length) : viewVisible;
              if (!generatedText.startsWith(streamVisible) && streamVisible !== generatedText) {
                // allow final == stream prefix exactly; else malformed
                if (generatedText !== streamVisible) {
                  finish(err('TEXT_MALFORMED_FINAL', 'stream/final mismatch'));
                  return;
                }
              }
            }
            const visibleText = visibility === 'visible' ? verifiedPrefix + generatedText : generatedText;
            finish(ok({ generatedText, visibleText }));
          } catch {
            finish(err('TEXT_MALFORMED_FINAL', 'final handler'));
          }
        },
      });
      hybrid = started.hybrid;
      nativePromise = started.promise;
      nativeStop = hybrid?.stop ?? null;
      // async settlement: if native promise rejects, map to error unless already settled via onFinish
      nativePromise.then(
        (v) => {
          if (settled) return;
          // if backend resolves without calling onFinish, treat as malformed unless v has generatedText
          const gv = (v as {generatedText?: unknown})?.generatedText;
          if (typeof gv === 'string') {
            let g = gv;
            if (requestedStart && !prefixChecked) {
              if (g.startsWith(requestedStart) && requestedStart.length > 0) { g = g.slice(requestedStart.length); verifiedPrefix = requestedStart; }
              else {
                const norm2 = requestedStart.replace(/ +$/, '');
                if (g.startsWith(norm2) && norm2.length > 0) { g = g.slice(norm2.length); if (g.startsWith(' ') && requestedStart.endsWith(' ')) g = g.slice(1); verifiedPrefix = requestedStart; }
                else { verifiedPrefix = requestedStart; }
              }
              prefixChecked = true;
            } else if (requestedStart && verifiedPrefix && g.startsWith(verifiedPrefix)) {
              g = g.slice(verifiedPrefix.length);
            }
            const t = truncateStop(g, stops);
            finish(ok({ generatedText: t.text, visibleText: visibility === 'visible' ? verifiedPrefix + t.text : t.text }));
          } else {
            finish(err('TEXT_MALFORMED_FINAL', 'no finish'));
          }
        },
        () => { if (!settled) finish(err('NATIVE_REJECTED', 'native rejected')); },
      );
    } catch {
      return err('NATIVE_SYNC_THROW', 'start threw');
    }

    return ok({
      operationId,
      completion,
      requestStop: () => {
        detached = true;
        if (!nativeStop) return unknown('no stop handle');
        try { nativeStop(); return ok({ stopInvoked: true }); }
        catch { return unknown('stop threw'); }
      },
      detachView: () => { detached = true; },
    });
  }

  return { metadata, start };
}

export type BoundText = ReturnType<typeof bindText>;
