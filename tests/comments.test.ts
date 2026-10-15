import { validateRoomKey, appChannelBase, parseChannel, escapeHtml } from '../src/comments/channel.js';
import { createRoomBinder, renderMessageSafe } from '../src/comments/bindRoom.js';

// ROOM-CHANNEL-LENGTH/ORDER/USERS
{
  if (!validateRoomKey('abc-123')) throw new Error('valid key');
  if (validateRoomKey('-bad')) throw new Error('leading hyphen');
  if (validateRoomKey('a'.repeat(65))) throw new Error('too long');
  if (appChannelBase('myroom') !== 'plr1-myroom') throw new Error('base');
  const p = parseChannel('plr1-myroom');
  if (p.base !== 'plr1-myroom') throw new Error('parse');
  try { parseChannel('plr1- room'); throw new Error('space must fail'); } catch(e){ if(!String(e).includes('ROOM_CHANNEL_INVALID')) throw e; }
  try { parseChannel('plr1-a+u:b|b'); throw new Error('dup users'); } catch(e){ if(!String(e).includes('ROOM_CHANNEL_INVALID')) throw e; }
  const auth = 'a'.repeat(64);
  const okc = parseChannel('plr1-a+ids:ch,u:x|y,auth:'+auth);
  if (okc.rules.length !== 3) throw new Error('ordered rules');
  try { parseChannel('plr1-a+auth:'+auth+',ids:ch'); throw new Error('order'); } catch(e){ if(!String(e).includes('ROOM_CHANNEL_INVALID')) throw e; }
}
// ROOM-NATIVE-COMPOSER vs CUSTOM
{
  function fakeHost(): unknown {
    return { appendChild(){}, innerHTML:'', setAttribute(){}, ownerDocument:null };
  }
  const binder = createRoomBinder(()=>({ toString:()=>' <iframe></iframe> ', submit(){}, setNicknameForNextComment(){}, setAvatarUrlForNextComment(){} }));
  const native = binder.mount({ channel:'general', host: fakeHost(), presentation:'native' }, { onInitial(){}, onMessage(){} });
  if (native.kind !== 'ok') throw new Error('native mount');
  const sub = await native.value.submit('hi');
  if (sub.kind !== 'error') throw new Error('native submit must be error (native composer only)');
  const custom = binder.mount({ channel:'plr1-testroom', host: fakeHost(), presentation:'custom-qualified', beforeSubmit:(t)=>t.trim() }, { onInitial(){}, onMessage(){} });
  if (custom.kind !== 'ok') throw new Error('custom mount');
  const r = await custom.value.submit('  hello  ');
  if (r.kind !== 'invoked') throw new Error('custom submit');
}
// ROOM-PRESUBMIT-ONCE (null cancels, undefined retains)
{
  let calls=0;
  const binder = createRoomBinder(()=>({ toString:()=>'x', submit(){}, setNicknameForNextComment(){}, setAvatarUrlForNextComment(){} }));
  function h(): unknown { return { appendChild(){}, innerHTML:'', setAttribute(){}, ownerDocument:null }; }
  const m1 = binder.mount({ channel:'plr1-a', host:h(), presentation:'custom-qualified', beforeSubmit:()=>null }, {onInitial(){},onMessage(){}});
  if (m1.kind!=='ok') throw new Error('m1');
  const s1 = await m1.value.submit('hi');
  if (s1.kind!=='error') throw new Error('null must cancel');
  const m2 = binder.mount({ channel:'plr1-a', host:h(), presentation:'custom-qualified', beforeSubmit:(t)=>{calls++; return undefined;} }, {onInitial(){},onMessage(){}});
  if (m2.kind!=='ok') throw new Error('m2');
  const s2 = await m2.value.submit('hi');
  if (s2.kind!=='invoked' || calls!==1) throw new Error('undefined retains once');
}
// ROOM-IDENTITY-ARMED-FAILURE quarantines
{
  const binder = createRoomBinder(()=>({ toString:()=>'x', submit(){}, setNicknameForNextComment(){ throw new Error('nick'); }, setAvatarUrlForNextComment(){} }));
  function h(): unknown { return { appendChild(){}, innerHTML:'', setAttribute(){}, ownerDocument:null }; }
  const m = binder.mount({ channel:'plr1-q', host:h(), presentation:'custom-qualified' }, {onInitial(){},onMessage(){}});
  if (m.kind!=='ok') throw new Error('mq');
  const s = await m.value.submit('hi', {nickname:'bob'});
  if (s.kind!=='error') throw new Error('setter fail must be error');
  const s2 = await m.value.submit('hi2');
  if (s2.kind!=='error') throw new Error('quarantined must block next');
}
// ROOM-HTML-UNSAFE never innerHTML
{
  const out = renderMessageSafe({localId:'1', bodyUnsafe:'<img src=x onerror=alert(1)>'});
  if (out.includes('<img')) throw new Error('must escape');
  if (!out.includes('&lt;img')) throw new Error('escape');
}
console.log('PASS comments');
