import { mapSensitivity, parseTrailingSuffixes, validateGalleryOptions, bindGallery } from '../src/image/gallery.js';

// Small, deterministic DOM fake: tests the binder contract, not browser layout.
class ElementStub {
  parentNode:ElementStub|null=null;
  children:ElementStub[]=[];
  innerHTML='';
  attributes:Record<string,string>={};
  ownerDocument={createElement:(_tag:string)=>new ElementStub()};
  setAttribute(k:string,v:string){this.attributes[k]=v;}
  getAttribute(k:string){return this.attributes[k]??null;}
  appendChild(child:ElementStub){this.children.push(child);child.parentNode=this;return child;}
  removeChild(child:ElementStub){const idx=this.children.indexOf(child);if(idx<0)throw Error('not owned');this.children.splice(idx,1);child.parentNode=null;return child;}
  replaceChildren(...children:ElementStub[]){for(const c of this.children)c.parentNode=null;this.children=[];for(const c of children)this.appendChild(c);}
  querySelector(selector:string):ElementStub|null{
    if(selector!=='iframe')return null;
    if(this.innerHTML.includes('<iframe')){const frame=new ElementStub();frame.setAttribute('src','https://example.org/gallery?sort=recent');return frame;}
    for(const child of this.children){const found=child.querySelector(selector);if(found)return found;}
    return null;
  }
}
const asHost=(el:ElementStub)=>el as unknown as HTMLElement;
const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};

assert(mapSensitivity({isNsfw:true})==='flagged','flagged');
assert(mapSensitivity({isNsfw:false})==='not_flagged','not_flagged');
assert(mapSensitivity({})==='unknown','missing must be unknown');
assert(mapSensitivity({isNsfw:'yes'})==='unknown','nonboolean unknown');
const suffix=parseTrailingSuffixes('a cat (seed:::123) (resolution:::512x768)');
assert(suffix.clean==='a cat'&&suffix.values['seed']==='123'&&suffix.values['resolution']==='512x768','suffix values');
assert(parseTrailingSuffixes('a (seed:::1) cat').clean==='a (seed:::1) cat','middle intact');
assert(parseTrailingSuffixes('hi (foo:::bar)').clean==='hi (foo:::bar)','unknown intact');
assert(validateGalleryOptions({sort:'bad' as never})!==null,'reject sort');

// Immediate iframe: mount is ready, observer settles synchronously and exactly once.
{
 const host=new ElementStub();
 const g=bindGallery({mountGallery:()=>'<iframe src="g"></iframe>'});
 const outcome=g.mount(asHost(host),{sort:'top'});
 assert(outcome.kind==='ok','immediate mount');
 if(outcome.kind!=='ok')throw Error('narrow');
 const states:string[]=[];
 outcome.value.observeReady(o=>states.push(o.state),1000);
 assert(states.join(',')==='pending,ready','immediate ready '+states);
 outcome.value.disposeHost();
 assert(host.children.length===0,'dispose own wrapper');
}
// Deferred native span. The binder MUST NOT reject it, reinvoke native,
// or mark ready before it becomes an iframe.
{
 const host=new ElementStub();let calls=0;
 const g=bindGallery({mountGallery:(_host,opts)=>{calls++;assert(opts['gallery']===true&&opts['adaptiveHeight']===true,'forward opts');return '<span id="native-gallery-pending"></span>';}});
 const result=g.mount(asHost(host),{sort:'recent',adaptiveHeight:true});
 assert(result.kind==='ok','pending gallery must mount');
 if(result.kind!=='ok')throw Error('narrow');
 const observed:string[]=[];
 result.value.observeReady(o=>observed.push(o.state),2000);
 assert(observed.join(',')==='pending','must not report early ready');
 (host.children[0] as ElementStub).innerHTML='<iframe src="gallery"></iframe>';
 await new Promise(resolve=>setTimeout(resolve,650));
 assert(observed.join(',')==='pending,ready','late iframe observed once '+observed);
 assert(calls===1,'exactly one native gallery call');
 result.value.disposeHost();
}
// Expired observation is UNKNOWN not a host error; a newer mount survives stale disposal.
{
 const host=new ElementStub();
 const g=bindGallery({mountGallery:()=>'<span></span>'});
 const first=g.mount(asHost(host),{});
 assert(first.kind==='ok','first');
 if(first.kind!=='ok')throw Error('narrow');
 const states:string[]=[];
 first.value.observeReady(o=>states.push(o.state),0);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert(states.join(',')==='pending,unknown','timeout '+states);
 const second=g.mount(asHost(host),{});
 assert(second.kind==='ok','second');
 if(second.kind!=='ok')throw Error('narrow');
 first.value.disposeHost();
 assert(host.children.length===1,'stale dispose must not remove later mount');
 second.value.disposeHost();
 assert(host.children.length===0,'new mount cleans itself');
}
// Explicit dispose resolves a pending readiness observer; no stray timer fires.
{
 const host=new ElementStub();
 const gal=bindGallery({mountGallery:()=>'<span></span>'});
 const res=gal.mount(asHost(host),{});
 assert(res.kind==='ok','pending dispose mount');
 if(res.kind!=='ok')throw Error('narrow');
 const states:string[]=[];
 res.value.observeReady(o=>states.push(o.state),1000);
 res.value.disposeHost();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert(states.join(',')==='pending,disposed','dispose reported once '+states);
}
// Callback translation happens once, and disposal fences late callbacks.
{
 const host=new ElementStub();let trigger:((d:Record<string,unknown>)=>void)|undefined;
 let got:unknown;
 const g=bindGallery({mountGallery:(_h,opts)=>{
   trigger=(opts['customButton'] as {onClick:(d:Record<string,unknown>)=>void}).onClick;
   return '<span></span>';
 }});
 const result=g.mount(asHost(host),{customButton:{emoji:'*',onClick:p=>{got=p;}}});
 assert(result.kind==='ok','callback mount');
 if(result.kind!=='ok')throw Error('narrow');
 trigger?.({imageId:'i1',isNsfw:true,prompt:'p'});
 assert((got as {sensitivity:string}).sensitivity==='flagged','sensitivity translation');
 got=null;
 result.value.disposeHost();
 trigger?.({imageId:'i2',isNsfw:false});
 assert(got===null,'no disposed callbacks');
}
assert(bindGallery({mountGallery:()=>'<script>alert(1)</script>'}).mount(asHost(new ElementStub()),{}).kind==='error','invalid markup rejected');
console.log('PASS gallery synchronous/deferred/readiness/timeout/disposal/callback');
