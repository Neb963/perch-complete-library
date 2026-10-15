import { runChatComposition } from '../src/composition/chatComposition.js';
import { FakeKvFolder } from '../src/core/outcome.js';
import { installMiniDom, createTestHost } from './helpers/dom-shim.js';
{
  installMiniDom();
  const folders = ((): (f: string) => FakeKvFolder =>{ const m=new Map<string, FakeKvFolder>(); return (f: string)=>{ let x=m.get(f); if(!x){x=new FakeKvFolder(); m.set(f,x);} return x; }; })();
  const defs = { convs: { folder:'f1', schemaMajor:1, validate:(v: unknown): v is {x:number} => true } };
  const textBackend = { metadata:()=>({countTokens:()=>1, idealMaxContextTokens:1}), startNative:(_o: unknown, hooks: { onChunk?: (c: {textChunk:string; fullTextSoFar:string; isFromStartWith:boolean})=>void; onFinish?: (r: {generatedText?:unknown})=>void })=>{ const p = (async ()=>{ hooks.onChunk?.({textChunk:'hi', fullTextSoFar:'hi', isFromStartWith:false}); hooks.onFinish?.({generatedText:'hi'}); return {generatedText:'hi'}; })(); return {hybrid:{stop(){}}, promise:p}; } };
  const roomFactory = (): { toString(): string; submit(t: string): void; setNicknameForNextComment(n: string): void; setAvatarUrlForNextComment(u: string): void } =>({ toString:()=>' <iframe></iframe> ', submit(){}, setNicknameForNextComment(){}, setAvatarUrlForNextComment(){} });
  const host = createTestHost();
  const r = await runChatComposition({ folders: folders as never, defs: defs as never, textBackend: textBackend as never, roomFactory: roomFactory as never, host: host as never });
  if (!r.ok || r.steps.length<8) throw new Error('composition steps=' + r.steps.length);
  void 0;
}
console.log('PASS chat composition');
