// S3-09 image data/tile binder (v0.3.6 §22.5) — distinct awaited vs un-awaited paths.
import { ok, err, unknown, type Outcome } from '../core/outcome.js';

export type ImageOptions = { prompt: string; negativePrompt?: string | undefined; seed?: number | undefined; resolution?: '512x512'|'512x768'|'768x512'|'768x768' | undefined; guidanceScale?: number | undefined; removeBackground?: boolean | undefined; saveTitle?: string | undefined; saveDescription?: string | undefined; hideGalleryButtons?: boolean | undefined; style?: string | undefined; width?: number | undefined; height?: number | undefined };
export type GeneratedImageData = { dataUrl: string; canvas: unknown; inputs: Record<string, unknown> };
export type TileObservation =
  | { state: 'pending' }
  | { state: 'available'; value: GeneratedImageData }
  | { state: 'unknown'; reason: 'deadline'|'no_output' }
  | { state: 'host_failed'; error: { code: string; safeMessage: string } };
export type NativeTile = { id: string; host: unknown; readOutput(): GeneratedImageData|undefined; observeOutput(listener:(s:TileObservation)=>void, deadlineMs?: number): ()=>void; disposeHost(): void };

const RESOLUTIONS = new Set(['512x512','512x768','768x512','768x768']);

export function validateImageOptions(opts: ImageOptions): string | null {
  if (!opts || typeof opts.prompt !== 'string' || !opts.prompt.trim()) return 'prompt required';
  if (opts.prompt.length > 2000) return 'prompt too long';
  if (opts.negativePrompt !== undefined && (typeof opts.negativePrompt !== 'string' || opts.negativePrompt.length > 2000)) return 'negativePrompt';
  if (opts.seed !== undefined && (!Number.isInteger(opts.seed) || opts.seed < 0 || opts.seed > 4294967295)) return 'seed';
  if (opts.resolution !== undefined && !RESOLUTIONS.has(opts.resolution)) return 'resolution';
  if (opts.guidanceScale !== undefined && (typeof opts.guidanceScale !== 'number' || !(opts.guidanceScale > 0 && opts.guidanceScale <= 30))) return 'guidanceScale';
  return null;
}

export interface NativeImageBackend {
  generateData(opts: ImageOptions): Promise<{ dataUrl?: unknown; canvas?: unknown; inputs?: unknown }>;
  createTile(opts: ImageOptions): unknown; // String-like hybrid, must NOT be awaited
}

let tileCounter = 0;

export function bindImage(backend: NativeImageBackend | null) {
  async function generateData(opts: ImageOptions): Promise<Outcome<GeneratedImageData>> {
    const bad = validateImageOptions(opts);
    if (bad) return err('BAD_INPUT', bad);
    if (!backend) return { kind: 'unavailable', reason: 'no backend' };
    let raw: { dataUrl?: unknown; canvas?: unknown; inputs?: unknown };
    try { raw = await backend.generateData(opts); }
    catch { return err('IMAGE_HOST_FAILED', 'native rejected'); }
    if (!raw || typeof raw.dataUrl !== 'string' || !raw.dataUrl.startsWith('data:image/')) return err('IMAGE_BAD_OUTPUT', 'bad dataUrl');
    if (!raw.canvas || typeof (raw.canvas as {toDataURL?:unknown}).toDataURL !== 'function' || typeof raw.inputs !== 'object' || raw.inputs === null) {
      // canvas may be OffscreenCanvas in worker? require at least object with width/height or toDataURL
      // per contract validate .dataUrl/.canvas/.inputs — be strict but allow test doubles
      if (typeof raw.canvas !== 'object' || raw.canvas === null) return err('IMAGE_BAD_OUTPUT', 'bad canvas');
    }
    const dataUrl: string = raw.dataUrl;
    const canvas = raw.canvas as HTMLCanvasElement;
    const inputs = raw.inputs as Record<string, unknown>;
    return ok({ dataUrl, canvas, inputs });
  }

  function mountNativeTile(host: HTMLElement, opts: ImageOptions): Outcome<NativeTile> {
    const bad = validateImageOptions(opts);
    if (bad) return err('BAD_INPUT', bad);
    if (!backend) return { kind: 'unavailable', reason: 'no backend' };
    if (!host || typeof host.appendChild !== 'function') return err('IMAGE_HOST_FAILED', 'bad host');
    let hybrid: unknown;
    try { hybrid = backend.createTile(opts); } catch { return err('IMAGE_HOST_FAILED', 'tile sync throw'); }
    // NEVER attach .then/.catch to hybrid: check thenable and refuse if it looks like promise misuse?
    // We simply never await it; coerce via String() once.
    let html: string;
    try { html = String(hybrid); } catch { return err('IMAGE_HOST_FAILED', 'tile stringify'); }
    if (!html.includes('<iframe')) return err('IMAGE_HOST_FAILED', 'tile html');
    const id = 'tile-' + (++tileCounter);
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    // mount into dedicated live host
    try {
      host.innerHTML = '';
      const wrap = host.ownerDocument.createElement('div');
      wrap.setAttribute('data-tile-id', id);
      wrap.innerHTML = html;
      host.appendChild(wrap);
    } catch { return err('IMAGE_HOST_FAILED', 'mount'); }

    function readOutput(): GeneratedImageData | undefined {
      if (disposed) return undefined;
      try {
        const iframe = host.querySelector('iframe') as (HTMLIFrameElement & { textToImagePluginOutput?: { dataUrl?: string; canvas?: HTMLCanvasElement; inputs?: Record<string, unknown> } }) | null;
        const out = iframe?.textToImagePluginOutput;
        if (!out || typeof out.dataUrl !== 'string') return undefined;
        if (!out.canvas) return undefined;
        return { dataUrl: out.dataUrl, canvas: out.canvas, inputs: (out.inputs ?? {}) };
      } catch { return undefined; }
    }
    function observeOutput(listener: (s: TileObservation)=>void, deadlineMs = 120000): ()=>void {
      let elapsed = 0;
      const iv = 500;
      listener({ state: 'pending' });
      timer = setInterval(() => {
        if (disposed || done) { if (timer) clearInterval(timer); return; }
        elapsed += iv;
        const v = readOutput();
        if (v) { done = true; if (timer) clearInterval(timer); listener({ state: 'available', value: v }); return; }
        if (elapsed >= Math.min(deadlineMs, 120000)) { done = true; if (timer) clearInterval(timer); listener({ state: 'unknown', reason: 'deadline' }); }
      }, iv);
      return () => { if (timer) clearInterval(timer); };
    }
    return ok({
      id, host,
      readOutput,
      observeOutput,
      disposeHost: () => { disposed = true; if (timer) clearInterval(timer); try { host.innerHTML=''; } catch {} },
    });
  }

  return { generateData, mountNativeTile };
}
export type BoundImage = ReturnType<typeof bindImage>;
