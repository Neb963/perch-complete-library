import { bindUpload } from '../src/files/upload.js';
{
  const good = bindUpload({ upload: async ()=>({ url:'https://user.uploads.dev/file/abc', bytes:3, deletionUrl:'https://secret/delete' }) } as never);
  const r = await good.upload('hi');
  if (r.kind!=='ok' || (r as {value:{url:string}}).value.url!=='https://user.uploads.dev/file/abc') throw new Error('upload');
  if ('deletionUrl' in (r as {value:object}).value) throw new Error('deletion must be stripped');
  const svcErr = bindUpload({ upload: async ()=>({ error:'over_daily_allowance' }) } as never);
  const e = await svcErr.upload('hi');
  if (e.kind==='ok') throw new Error('service error must fail');
  const badUrl = bindUpload({ upload: async ()=>({ url:'http://bad' }) } as never);
  const b = await badUrl.upload('hi');
  if (b.kind==='ok') throw new Error('bad url');
  const throws = bindUpload({ upload: async ()=>{ throw new Error('net'); } } as never);
  const t = await throws.upload('hi');
  if (t.kind==='ok') throw new Error('throw must fail');
}
console.log('PASS upload');
