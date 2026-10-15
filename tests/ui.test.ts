import { Button, Field, Dialog, Tabs, Status } from './legacy/ui/primitives.js';
import { installMiniDom } from './helpers/dom-shim.js';
installMiniDom();
function getDoc(): { createElement: (t: string) => { appendChild: (c: unknown) => void }; body: { appendChild: (c: unknown) => void } } { return (globalThis as unknown as { __dom: { document: { createElement: (t: string) => { appendChild: (c: unknown) => void }; body: { appendChild: (c: unknown) => void } } } }).__dom.document; }
function host(): HTMLElement { const d = getDoc(); const el = d.createElement('div'); d.body.appendChild(el); return el as unknown as HTMLElement; }
{
  const h = host();
  let n=0;
  const b = Button.mount(h, {id:'app-b1', label:'Go'}, ()=>{n++;});
  b.element.click();
  b.element.click();
  if (n!==1) throw new Error('dedup '+n);
  b.update({id:'app-b1', label:'Go', disabled:true});
  b.element.click();
  if (n!==1) throw new Error('disabled');
  b.dispose();
}
{
  const h = host();
  const f = Field.mount(h, {id:'app-f1', label:'Pick', kind:'file', value:null}, ()=>{});
  if (!f.element) throw new Error('field');
  f.dispose();
}
{
  const h = host();
  const d = Dialog.mount(h, {id:'app-d1', open:true, title:'T'}, ()=>{});
  if (!d.contentEl) throw new Error('content');
  d.update({id:'app-d1', open:false, title:'T'});
  d.dispose();
}
{
  const h = host();
  const t = Tabs.mount(h, {id:'app-t1', selectedId:'a', tabs:[{id:'a',label:'A'},{id:'b',label:'B'}]}, ()=>{});
  t.update({id:'app-t1', selectedId:'b', tabs:[{id:'a',label:'A'},{id:'b',label:'B'}]});
  t.dispose();
}
{
  const h = host();
  const s = Status.mount(h, {id:'app-s1', message:'hi', politeness:'polite'}, ()=>{});
  if (s.element.getAttribute('aria-live')!=='polite') throw new Error('politeness');
  s.dispose();
}
console.log('PASS ui primitives');
