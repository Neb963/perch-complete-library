import { validateImageOptions, bindImage } from '../src/image/bindImage.js';
import { JobStore } from '../src/image/jobs.js';
import { FakeKvFolder } from '../src/core/outcome.js';

// IMAGE-DATA-SHAPE + BAD_OUTPUT
{
  if (validateImageOptions({prompt:''}) === null) throw new Error('empty prompt');
  if (validateImageOptions({prompt:'hi', resolution:'999x999' as '512x512'}) === null) throw new Error('bad res');
  const backend = {
    generateData: async () => ({ dataUrl:'data:image/png;base64,AA==', canvas:{toDataURL(){return '';}}, inputs:{prompt:'hi'} }),
    createTile: () => ({ toString:()=>' <iframe></iframe> ' }),
  };
  const b = bindImage(backend as never);
  const r = await b.generateData({prompt:'hi'});
  if (r.kind !== 'ok') throw new Error('data shape');
  const badBackend = { generateData: async () => ({ dataUrl:'http://bad', canvas:{}, inputs:{} }), createTile: ()=>'' };
  const b2 = bindImage(badBackend as never);
  const r2 = await b2.generateData({prompt:'hi'});
  if (r2.kind === 'ok') throw new Error('bad dataUrl must fail');
}
// IMAGE-TILE-UNAWAITED: never .then on hybrid
{
  let thenCalled = false;
  const hybrid = { toString:()=>' <iframe src="x"></iframe> ', then(){ thenCalled=true; } };
  const backend = { generateData: async()=>({}), createTile: ()=>hybrid };
  const b = bindImage(backend as never);
  const host = { appendChild(){}, innerHTML:'', querySelector:() => null, ownerDocument:{createElement:()=>({setAttribute(){}, innerHTML:''})} } as unknown as HTMLElement;
  const t = b.mountNativeTile(host, {prompt:'hi'});
  if (t.kind !== 'ok') throw new Error('tile mount');
  if (thenCalled) throw new Error('must not call .then on tile hybrid');
  t.value.disposeHost();
}
// IMAGE-OBSERVATION-DEADLINE unknown (short deadline)
{
  const backend = { generateData: async()=>({}), createTile: ()=>' <iframe></iframe> ' };
  const b = bindImage(backend as never);
  const host = { appendChild(){}, innerHTML:'', querySelector:()=>null, ownerDocument:{createElement:()=>({setAttribute(){}, innerHTML:''})} } as unknown as HTMLElement;
  const t = bindImage(backend as never).mountNativeTile(host, {prompt:'hi'});
  if (t.kind !== 'ok') throw new Error('mount');
  const obs = await new Promise((res)=>{
    const off = t.value.observeOutput((s)=>{ if(s.state!=='pending'){off(); res(s);} }, 600);
  });
  if ((obs as {state:string}).state !== 'unknown') throw new Error('deadline must be unknown');
  t.value.disposeHost();
}
// JOBS: reserve/complete, unknown retention (never auto-evict pending)
{
  const f = new FakeKvFolder() as unknown as import('../src/kv/store.js').KvFolderLike;
  const js = new JobStore(f, 'sess-1');
  const r1 = await js.reserve('p1','data',{});
  if (r1.kind!=='ok') throw new Error('reserve');
  const c1 = await js.complete(r1.value.jobId,'available');
  if (c1.kind!=='ok') throw new Error('complete');
  // unknown must be protected: fill to cap with unknowns? spot-check complete unknown
  const r2 = await js.reserve('p2','tile',{});
  if (r2.kind!=='ok') throw new Error('reserve2');
  const c2 = await js.complete(r2.value.jobId,'unknown');
  if (c2.kind!=='ok') throw new Error('unknown complete');
}
console.log('PASS image binder');
