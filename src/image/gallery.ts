// S3-11 gallery binder + callback validation (v0.3.6 §22.5).
// Native galleries can return an inert-looking <span> first; Perchance upgrades it
// asynchronously to the actual iframe. Mount success is NOT readiness evidence.
import { ok, err, type Outcome } from '../core/outcome.js';

export type GalleryOptions = { sort?: 'top'|'recent'|'trending' | undefined; contentFilter?: string | undefined; timeRange?: string | undefined; adaptiveHeight?: boolean | undefined; hideIfScoreIsBelow?: number | undefined; defaultGalleryNames?: string | undefined; style?: string | undefined; bannedUsers?: string[] | undefined; bannedPromptPhrases?: string[] | undefined; bannedNegativePromptPhrases?: string[] | undefined; customButton?: { emoji: string; onClick:(p:GalleryClickPayload)=>void } | undefined; customButton2?: { emoji: string; onClick:(p:GalleryClickPayload)=>void } | undefined };
export type GalleryClickPayload = { imageId?: string | undefined; imageUrl?: string | undefined; userId?: string | undefined; prompt?: string | undefined; negativePrompt?: string | undefined; guidanceScale?: number | undefined; seed?: number | undefined; galleryName?: string | undefined; sensitivity: 'flagged'|'not_flagged'|'unknown' };

export type GalleryObservation =
  | { state:'pending' }
  | { state:'ready'; iframe: HTMLIFrameElement }
  | { state:'unknown'; reason:'deadline'|'host_removed' }
  | { state:'disposed' };
export interface GalleryHandle {
  /** Observe exactly this mount, not another iframe in the host. No native calls. */
  observeReady(onObservation:(observation:GalleryObservation)=>void, deadlineMs?:number):()=>void;
  disposeHost():void;
}

const SUFFIX_ALLOW = new Set(['resolution','size','negativePrompt','guidanceScale','removeBackground','saveTitle','saveDescription','hideGalleryButtons','seed','width','height','style']);

export function mapSensitivity(native: { isNsfw?: unknown }): 'flagged'|'not_flagged'|'unknown' {
  if (native.isNsfw === true) return 'flagged';
  if (native.isNsfw === false) return 'not_flagged';
  return 'unknown';
}

export function parseTrailingSuffixes(prompt: string): { clean: string; values: Record<string,string>; stripped: string[] } {
  const re = /\s*\(([^:()]+):::([^()]+?)\)\s*$/;
  const values: Record<string,string> = {};
  const stripped: string[] = [];
  let clean = prompt;
  while (true) {
    const m = re.exec(clean);
    if (!m) break;
    const k: string = (m[1] ?? '').trim();
    const v: string = (m[2] ?? '').trim();
    if (!SUFFIX_ALLOW.has(k) || !v) break;
    if (v.includes('(') || v.includes(')')) break;
    values[k] = v;
    stripped.unshift(k);
    clean = clean.slice(0, m.index);
  }
  return { clean: clean.trim(), values, stripped };
}

export function validateGalleryOptions(o: GalleryOptions): string | null {
  if (o.sort !== undefined && !['top','recent','trending'].includes(o.sort)) return 'sort';
  if (o.hideIfScoreIsBelow !== undefined && (!Number.isFinite(o.hideIfScoreIsBelow))) return 'hideIfScore';
  if (o.bannedUsers !== undefined && (!Array.isArray(o.bannedUsers) || o.bannedUsers.length > 500)) return 'bannedUsers';
  if (o.bannedPromptPhrases !== undefined && (!Array.isArray(o.bannedPromptPhrases) || o.bannedPromptPhrases.length > 200)) return 'bannedPrompt';
  if (o.bannedNegativePromptPhrases !== undefined && (!Array.isArray(o.bannedNegativePromptPhrases) || o.bannedNegativePromptPhrases.length > 200)) return 'bannedNegativePrompt';
  return null;
}

export interface GalleryBackend { mountGallery(host: HTMLElement, opts: Record<string,unknown>): string; }

export function bindGallery(backend: GalleryBackend | null) {
  function mount(host: HTMLElement, options: GalleryOptions): Outcome<GalleryHandle> {
    const bad = validateGalleryOptions(options);
    if (bad) return err('BAD_INPUT', bad);
    if (!backend) return { kind: 'unavailable', reason: 'no backend' };
    if (!host || typeof host.appendChild !== 'function' || !host.ownerDocument || typeof host.ownerDocument.createElement !== 'function') {
      return err('IMAGE_HOST_FAILED', 'bad host');
    }
    // All selected options are forwarded to the native gallery; callback payloads
    // alone are normalized by the adapter. Never mutate consumer-supplied objects.
    const {customButton,customButton2,...nativeFields} = options;
    const nativeOpts: Record<string,unknown> = { gallery:true, ...nativeFields };
    let disposed = false;
    const buildCallback = (cb:NonNullable<GalleryOptions['customButton']>, key:string):string | null => {
      if (typeof cb.emoji !== 'string' || !cb.emoji || typeof cb.onClick !== 'function') return key;
      nativeOpts[key] = {
        emoji: cb.emoji,
        onClick: (data: Record<string,unknown>) => {
          if (disposed || !data || typeof data !== 'object') return;
          const payload: GalleryClickPayload = {
            imageId: typeof data['imageId']==='string'?data['imageId']:undefined,
            imageUrl: typeof data['imageUrl']==='string'?data['imageUrl']:undefined,
            userId: typeof data['userId']==='string'?data['userId']:undefined,
            prompt: typeof data['prompt']==='string'?data['prompt']:undefined,
            negativePrompt: typeof data['negativePrompt']==='string'?data['negativePrompt']:undefined,
            guidanceScale: typeof data['guidanceScale']==='number'&&Number.isFinite(data['guidanceScale'])?data['guidanceScale']:undefined,
            seed: typeof data['seed']==='number'&&Number.isFinite(data['seed'])?data['seed']:undefined,
            galleryName: typeof data['galleryName']==='string'?data['galleryName']:undefined,
            sensitivity: mapSensitivity(data as {isNsfw?:unknown}),
          };
          try { cb.onClick(payload); } catch { /* consumer callback cannot disrupt native gallery */ }
        },
      };
      return null;
    };
    if(customButton){const invalid=buildCallback(customButton,'customButton');if(invalid)return err('BAD_INPUT',invalid);}
    if(customButton2){const invalid=buildCallback(customButton2,'customButton2');if(invalid)return err('BAD_INPUT',invalid);}

    let html: string;
    try { html = backend.mountGallery(host, nativeOpts); } catch { return err('IMAGE_HOST_FAILED', 'gallery throw'); }
    // The platform may synchronously supply an <iframe>, or initially a <span>
    // which upgrades after asynchronous native initialization. Refusing the <span>
    // destroys that initialization path. Do not interpret an accepted span as ready.
    if (typeof html !== 'string' || !/^\s*<(?:iframe|span)\b/i.test(html)) return err('IMAGE_HOST_FAILED', 'gallery html');
    const token = Math.random().toString(36).slice(2);
    let wrap: HTMLElement;
    try {
      wrap = host.ownerDocument.createElement('div');
      wrap.setAttribute('data-gallery-token', token);
      wrap.innerHTML = html;
      // Host is dedicated to this binder. Insert the exact native HTML once;
      // never call the native factory again to poll for completion.
      host.replaceChildren(wrap);
    } catch { return err('IMAGE_HOST_FAILED','mount'); }

    const subscriptions = new Set<{stop:()=>void; emitDisposed:()=>void}>();
    function observeReady(onObservation:(observation:GalleryObservation)=>void, deadlineMs=90000):()=>void {
      if (typeof onObservation !== 'function') return ()=>{};
      if (disposed) {onObservation({state:'disposed'});return ()=>{};}
      const duration = Number.isFinite(deadlineMs) ? Math.min(120000,Math.max(0,deadlineMs)) : 90000;
      let ended=false;
      let interval:ReturnType<typeof setInterval>|undefined;
      let timeout:ReturnType<typeof setTimeout>|undefined;
      let observer:MutationObserver|undefined;
      const emit=(o:GalleryObservation)=>{try{onObservation(o);}catch{/* observer isolation */}};
      const subscription={stop:()=>{},emitDisposed:()=>{emit({state:'disposed'});}};
      const unsubscribe=()=>{
        if(ended)return;
        ended=true;
        if(interval!==undefined)clearInterval(interval);
        if(timeout!==undefined)clearTimeout(timeout);
        observer?.disconnect();
        subscriptions.delete(subscription);
      };
      subscription.stop=unsubscribe;
      subscriptions.add(subscription);
      const inspect=()=>{
        if(ended)return;
        if(disposed){unsubscribe();emit({state:'disposed'});return;}
        // A stale handle may never signal success for a replacement mount.
        if(wrap.parentNode!==host){unsubscribe();emit({state:'unknown',reason:'host_removed'});return;}
        const frame=wrap.querySelector('iframe');
        if(frame){unsubscribe();emit({state:'ready',iframe:frame});}
      };
      emit({state:'pending'});
      inspect();
      if(!ended){
        if(typeof MutationObserver!=='undefined'){
          observer=new MutationObserver(inspect);
          observer.observe(wrap,{subtree:true,childList:true});
        }
        interval=setInterval(inspect,500);
        timeout=setTimeout(()=>{if(!ended){unsubscribe();emit({state:'unknown',reason:'deadline'});}},duration);
      }
      return unsubscribe;
    }
    function disposeHost():void {
      if(disposed)return;
      disposed=true;
      // Resolve pending local observers on disposal; an old handle cannot
      // remove or report readiness for an independent later mount.
      for(const subscription of Array.from(subscriptions)){
        subscription.stop();
        subscription.emitDisposed();
      }
      try {if(wrap.parentNode===host)host.removeChild(wrap);}catch{}
    }
    return ok({ observeReady, disposeHost });
  }
  return { mount };
}
