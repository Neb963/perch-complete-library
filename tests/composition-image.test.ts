import { runImageComposition } from '../src/composition/imageComposition.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { installMiniDom, createTestHost } from './helpers/dom-shim.js';
{
  installMiniDom();
  const doc = (globalThis as unknown as { __dom: { document: { createElement: (t: string) => unknown } } }).__dom.document;
  void doc;
  const f = new FakeKvFolder() as never;
  const imgBackend = { generateData: async ()=>({dataUrl:'data:image/png;base64,AA==', canvas:{toDataURL(){ return ''; }}, inputs:{prompt:'hi'}}), createTile:()=>' <iframe></iframe> ' } as never;
  const galBackend = { mountGallery: () => '<iframe></iframe>' } as never;
  const galleryHost = createTestHost() as never;
  const tileHost = createTestHost() as never;
  const r = await runImageComposition({ folder:f, sessionId:'s1', galleryBackend:galBackend, imageBackend:imgBackend, galleryHost, tileHost });
  if (!r.ok || r.steps.length<8) throw new Error('image composition steps=' + r.steps.length);
}
console.log('PASS image composition');
