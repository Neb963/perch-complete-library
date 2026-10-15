import { normalizeHostedMedia, classifyHostedMedia, gateProtectedUsers } from '../src/safety/classify.js';
{
  const good = normalizeHostedMedia('https://aigc.uploads.dev/image/' + 'a'.repeat(64) + '.jpg');
  if (!good.ok || !good.endpoint?.includes('imageTags')) throw new Error('aigc route');
  const bad = normalizeHostedMedia('not-a-url');
  if (bad.ok) throw new Error('bare id must be invalid at app port');
  const trav = normalizeHostedMedia('https://user.uploads.dev/file/../secret');
  if (trav.ok) throw new Error('traversal');
  const uns = normalizeHostedMedia('https://editable.uploads.dev/file/x');
  if (uns.ok || uns.reason!=='unsupported') throw new Error('editable unsupported');
  const nf = await classifyHostedMedia('https://aigc.uploads.dev/image/' + 'b'.repeat(64) + '.png', async ()=>({status:404, body:{error:'not_found'}}));
  if (nf.kind!=='unknown') throw new Error('not_found unknown');
  const inv = await classifyHostedMedia('https://aigc.uploads.dev/image/' + 'c'.repeat(64) + '.jpg', async ()=>({status:200, body:{error:'invalid_image_url'}}));
  if (inv.kind!=='invalid') throw new Error('invalid');
  const net = await classifyHostedMedia('https://aigc.uploads.dev/image/' + 'd'.repeat(64) + '.jpg', async ()=>{ throw new Error('net'); });
  if (net.kind!=='unknown') throw new Error('network unknown');
  const tags = await classifyHostedMedia('https://aigc.uploads.dev/image/' + 'e'.repeat(64) + '.jpg', async ()=>({status:200, body:{tags:[]}}));
  if (tags.kind!=='tags') throw new Error('tags');
  if (gateProtectedUsers({kind:'unknown', reason:'x'}).allow) throw new Error('fail-closed');
  if (!gateProtectedUsers({kind:'tags', tags:[], source:'imageTags'}).allow) throw new Error('empty tags allow');
  if (gateProtectedUsers({kind:'tags', tags:['nsfw'], source:'imageTags'}).allow) throw new Error('nsfw block');
}
console.log('PASS classify');
