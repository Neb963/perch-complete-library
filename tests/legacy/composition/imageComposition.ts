// S3-17 image composition — real consumer flow:
// bootstrap → image data/tile → job history → KV persistence → gallery → UI → reload.
import { JobStore } from '../../../src/image/jobs.js';
import { bindGallery } from '../../../src/image/gallery.js';
import { bindImage, type NativeImageBackend } from '../../../src/image/bindImage.js';
import type { KvFolderLike } from '../../../src/kv/store.js';

export type ImageCompDeps = {
  folder: KvFolderLike;
  sessionId: string;
  galleryBackend: { mountGallery(host: HTMLElement, opts: Record<string, unknown>): string };
  imageBackend: NativeImageBackend;
  galleryHost: HTMLElement;
  tileHost: HTMLElement;
};

export async function runImageComposition(deps: ImageCompDeps): Promise<{ ok: boolean; steps: string[] }> {
  const steps: string[] = [];
  const js = new JobStore(deps.folder, deps.sessionId);
  const r = await js.reserve('A simple blue geometric cube on white background', 'data', {});
  if (r.kind !== 'ok') throw new Error('reserve: ' + JSON.stringify(r));
  steps.push('job-reserved:' + r.value.jobId);
  // Dispatch generation (data mode) while job pending
  const img = bindImage(deps.imageBackend);
  const gen = await img.generateData({ prompt: 'A simple blue geometric cube on white background' });
  // Generation may be unavailable in offline fake; record outcome without fabricating success.
  if (gen.kind === 'ok') {
    steps.push('image-generated');
    const c = await js.complete(r.value.jobId, 'available', gen.value.dataUrl.slice(0, 64));
    if (c.kind !== 'ok') throw new Error('complete: ' + JSON.stringify(c));
    steps.push('job-available');
  } else if (gen.kind === 'unavailable') {
    steps.push('image-unavailable');
    const c = await js.complete(r.value.jobId, 'unknown');
    if (c.kind !== 'ok') throw new Error('unknown complete');
    steps.push('job-unknown-retained');
  } else {
    steps.push('image-failed:' + gen.kind);
    const c = await js.complete(r.value.jobId, 'failed');
    if (c.kind !== 'ok') throw new Error('failed complete');
    steps.push('job-failed');
  }
  // Favorite toggle racing completion is covered in unit tests; here verify favorite persists.
  const fav = await js.setFavorite(r.value.jobId, true);
  if (fav.kind !== 'ok') throw new Error('favorite');
  steps.push('job-favorited');
  // Gallery mount with validated callbacks
  const gal = bindGallery(deps.galleryBackend);
  const gm = gal.mount(deps.galleryHost, { sort: 'top' });
  if (gm.kind !== 'ok') throw new Error('gallery mount');
  steps.push('gallery-mounted');
  gm.value.disposeHost();
  steps.push('gallery-disposed');
  // Tile mount (un-awaited path) — must not await hybrid
  const tile = img.mountNativeTile(deps.tileHost, { prompt: 'cube' });
  if (tile.kind !== 'ok') throw new Error('tile mount: ' + JSON.stringify(tile));
  steps.push('tile-mounted');
  tile.value.disposeHost();
  steps.push('tile-disposed');
  // Reload: new JobStore view over same folder must see retained history
  const js2 = new JobStore(deps.folder, deps.sessionId);
  const loaded = await js2.load();
  if (loaded.kind !== 'ok' || !loaded.value.jobs.some(j => j.id === r.value.jobId)) {
    throw new Error('reload missing job');
  }
  steps.push('reload-verified:' + loaded.value.jobs.length);
  return { ok: true, steps };
}
