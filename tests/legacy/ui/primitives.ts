// S3-12 UI primitives — 8 controlled components, typed UIHandle, focus/ARIA/intent/dispose (v0.3.6 §22)
export type UIIntent =
  | { kind: 'activate'|'retry'|'dismiss'; id: string }
  | { kind: 'change'; id: string; value: string|number|boolean|null }
  | { kind: 'select'|'navigate'|'download'; id: string; targetId?: string | undefined };
export type BaseProps = { id: string; disabled?: boolean | undefined; busy?: boolean | undefined; errorMessage?: string | undefined };
export type UIHandle<P> = { element: HTMLElement; update:(props:P)=>void; dispose():void; contentEl?: HTMLElement | undefined };
export type UIComponent<P> = { mount(parent: HTMLElement, props: P, onIntent:(i:UIIntent)=>void): UIHandle<P> };
export type ButtonProps = BaseProps & { label: string; variant?: 'primary'|'secondary'|'quiet' | undefined };
export type FieldProps = BaseProps & { label: string; kind: 'text'|'multiline'|'number'|'select'|'toggle'|'file'; value: string|number|boolean|null; required?: boolean | undefined; min?: number | undefined; max?: number | undefined; step?: number | undefined; options?: ReadonlyArray<{value:string; label:string; disabled?:boolean}> | undefined; accept?: string | undefined; multiple?: boolean | undefined };
export type DialogProps = BaseProps & { open: boolean; title: string; returnFocusTo?: HTMLElement|null | undefined; labelledById?: string | undefined };
export type TabsProps = BaseProps & { selectedId: string; tabs: ReadonlyArray<{id:string; label:string; disabled?:boolean}> };
export type MenuProps = BaseProps & { open: boolean; items: ReadonlyArray<{id:string; label:string; disabled?:boolean}> };
export type StatusProps = BaseProps & { message: string; politeness: 'polite'|'assertive'|'off' };
export type ScrollHostProps = BaseProps & { autoStickToEnd?: boolean };
export type MediaTileProps = BaseProps & { state: 'empty'|'pending'|'available'|'unknown'|'failed'; alt: string; media: {kind:'url'; url:string}|{kind:'canvas'; canvas:HTMLCanvasElement}|{kind:'native-host'; element:HTMLElement}|null };

function setBase(el: HTMLElement, p: BaseProps): void {
  el.setAttribute('data-app-id', p.id);
  (el as HTMLButtonElement).disabled = !!p.disabled;
  el.setAttribute('aria-disabled', String(!!p.disabled));
  if (p.busy) el.setAttribute('aria-busy','true'); else el.removeAttribute('aria-busy');
  el.hidden = false;
}

function guardedIntent(id: string, disabled: boolean|undefined, busy: boolean|undefined, emit: ()=>void): void {
  if (disabled || busy) return; // no inert actions, no phantom writes
  emit();
}

export const Button: UIComponent<ButtonProps> = {
  mount(parent, props, onIntent) {
    const el = parent.ownerDocument.createElement('button');
    el.type = 'button';
    let cur = props;
    let disposed = false;
    let lastClick = 0;
    function render(): void {
      el.textContent = cur.label;
      el.setAttribute('data-variant', cur.variant ?? 'primary');
      setBase(el, cur);
      el.setAttribute('aria-label', cur.label);
    }
    function onClick(e: Event): void {
      e.preventDefault();
      const now = Date.now();
      if (now - lastClick < 300) return; // no duplicate emission on double click
      lastClick = now;
      guardedIntent(cur.id, cur.disabled, cur.busy, ()=>{ if(!disposed) onIntent({kind:'activate', id:cur.id}); });
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
    }
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey as EventListener);
    render();
    parent.appendChild(el);
    return {
      element: el,
      update: (p: ButtonProps) => { if(disposed) return; cur = p; render(); },
      dispose: () => { disposed = true; el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey as EventListener); el.remove(); },
    };
  },
};

export const Field: UIComponent<FieldProps> = {
  mount(parent, props, onIntent) {
    const doc = parent.ownerDocument;
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-field', props.id);
    const label = doc.createElement('label');
    label.textContent = props.label;
    wrap.appendChild(label);
    let input: HTMLElement;
    let cur = props;
    let disposed = false;
    function build(): HTMLElement {
      if (cur.kind === 'multiline') { const t = doc.createElement('textarea'); t.value = String(cur.value ?? ''); return t; }
      if (cur.kind === 'select') {
        const s = doc.createElement('select');
        for (const o of cur.options ?? []) { const op = doc.createElement('option'); op.value=o.value; op.textContent=o.label; op.disabled=!!o.disabled; s.appendChild(op); }
        s.value = String(cur.value ?? '');
        return s;
      }
      if (cur.kind === 'toggle') { const c = doc.createElement('input'); c.type='checkbox'; (c as HTMLInputElement).checked=!!cur.value; return c; }
      if (cur.kind === 'file') { const f = doc.createElement('input'); f.type='file'; if(cur.accept) f.setAttribute('accept',cur.accept); if(cur.multiple) f.multiple=true; return f; }
      if (cur.kind === 'number') { const n = doc.createElement('input'); n.type='number'; n.value=String(cur.value ?? ''); if(cur.min!==undefined) n.min=String(cur.min); if(cur.max!==undefined) n.max=String(cur.max); return n; }
      const t = doc.createElement('input'); t.type='text'; t.value=String(cur.value ?? ''); return t;
    }
    function render(): void {
      // rebuild input on kind change (controlled-state, no phantom writes)
      while (wrap.childNodes.length > 1) wrap.removeChild(wrap.lastChild as Node);
      input = build();
      input.setAttribute('aria-label', cur.label);
      if (cur.disabled) (input as HTMLInputElement).disabled = true;
      if (cur.required) (input as HTMLInputElement).required = true;
      // file never places File in persisted value: emit event only
      if (cur.kind === 'file') {
        input.addEventListener('change', onFile);
      } else {
        input.addEventListener('change', onChange);
      }
      wrap.appendChild(input);
      setBase(wrap, cur);
    }
    function onChange(): void {
      if (disposed || cur.disabled) return;
      const v = (input as HTMLInputElement).value;
      onIntent({kind:'change', id:cur.id, value: cur.kind==='number' ? (v==='' ? null : Number(v)) : v});
    }
    function onFile(): void {
      if (disposed || cur.disabled) return;
      const files = (input as HTMLInputElement).files;
      // explicit file-selection event via change with File count (never store FileList in value)
      onIntent({kind:'change', id:cur.id, value: files?.length ?? 0});
    }
    render();
    parent.appendChild(wrap);
    return {
      element: wrap,
      update: (p: FieldProps) => { if(disposed) return; cur = p; label.textContent = p.label; render(); },
      dispose: () => { disposed = true; wrap.remove(); },
    };
  },
};

export const Dialog: UIComponent<DialogProps> = {
  mount(parent, props, onIntent) {
    const doc = parent.ownerDocument;
    const el = doc.createElement('div');
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
    const content = doc.createElement('div');
    el.appendChild(content);
    let cur = props;
    let disposed = false;
    let prevFocus: HTMLElement|null = null;
    function render(): void {
      el.hidden = !cur.open;
      el.setAttribute('aria-label', cur.title);
      if (cur.labelledById) el.setAttribute('aria-labelledby', cur.labelledById);
      setBase(el, cur);
      if (cur.open) {
        prevFocus = (doc.activeElement as HTMLElement) ?? null;
        // focus first focusable
        const f = el.querySelector('button,[href],input,select,textarea,[tabindex]') as HTMLElement|null;
        (f ?? el).focus?.();
      } else {
        // return focus
        const target = cur.returnFocusTo ?? prevFocus;
        (target as HTMLElement)?.focus?.();
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && cur.open && !cur.disabled) onIntent({kind:'dismiss', id:cur.id});
    }
    el.addEventListener('keydown', onKey as EventListener);
    render();
    parent.appendChild(el);
    return { element: el, contentEl: content, update:(p:DialogProps)=>{if(disposed)return; cur=p; render();}, dispose:()=>{disposed=true; el.removeEventListener('keydown', onKey as EventListener); el.remove();} };
  },
};

export const Tabs: UIComponent<TabsProps> = {
  mount(parent, props, onIntent) {
    const doc = parent.ownerDocument;
    const el = doc.createElement('div');
    el.setAttribute('role','tablist');
    let cur = props;
    let disposed = false;
    function render(): void {
      el.innerHTML='';
      for (const t of cur.tabs) {
        const b = doc.createElement('button');
        b.setAttribute('role','tab');
        b.textContent = t.label;
        b.setAttribute('aria-selected', String(t.id===cur.selectedId));
        (b as HTMLButtonElement).disabled = !!t.disabled || !!cur.disabled;
        b.addEventListener('click', ()=>{ if(!disposed && !t.disabled && !cur.disabled) onIntent({kind:'select', id:cur.id, targetId:t.id}); });
        b.addEventListener('keydown', (e:KeyboardEvent)=>{
          if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
            const idx = cur.tabs.findIndex(x=>x.id===t.id);
            const next: { id: string; label: string; disabled?: boolean } | undefined = e.key==='ArrowRight' ? cur.tabs[(idx+1)%cur.tabs.length] : cur.tabs[(idx-1+cur.tabs.length)%cur.tabs.length];
            if(next && !next.disabled) onIntent({kind:'select', id:cur.id, targetId:next.id});
          }
        });
        el.appendChild(b);
      }
      setBase(el, cur);
    }
    render();
    parent.appendChild(el);
    return { element: el, update:(p:TabsProps)=>{if(disposed)return; cur=p; render();}, dispose:()=>{disposed=true; el.remove();} };
  },
};

export const Menu: UIComponent<MenuProps> = {
  mount(parent, props, onIntent) {
    const doc = parent.ownerDocument;
    const el = doc.createElement('div');
    el.setAttribute('role','menu');
    let cur = props;
    let disposed = false;
    function render(): void {
      el.hidden = !cur.open;
      el.innerHTML='';
      for (const it of cur.items) {
        const b = doc.createElement('button');
        b.setAttribute('role','menuitem');
        b.textContent = it.label;
        (b as HTMLButtonElement).disabled = !!it.disabled || !!cur.disabled;
        b.addEventListener('click', ()=>{ if(!disposed && !it.disabled) onIntent({kind:'select', id:cur.id, targetId:it.id}); });
        el.appendChild(b);
      }
      setBase(el, cur);
      el.hidden = !cur.open;
    }
    render();
    parent.appendChild(el);
    return { element: el, update:(p:MenuProps)=>{if(disposed)return; cur=p; render();}, dispose:()=>{disposed=true; el.remove();} };
  },
};

export const Status: UIComponent<StatusProps> = {
  mount(parent, props, onIntent) {
    void onIntent;
    const el = parent.ownerDocument.createElement('div');
    el.setAttribute('role','status');
    let cur = props;
    function render(): void {
      el.textContent = cur.message;
      el.setAttribute('aria-live', cur.politeness==='off' ? 'off' : cur.politeness);
      setBase(el, cur);
    }
    render();
    parent.appendChild(el);
    return { element: el, update:(p:StatusProps)=>{cur=p; render();}, dispose:()=>{el.remove();} };
  },
};

export const ScrollHost: UIComponent<ScrollHostProps> = {
  mount(parent, props, onIntent) {
    void onIntent;
    const el = parent.ownerDocument.createElement('div');
    el.setAttribute('data-scrollhost', props.id);
    el.style.overflowY = 'auto';
    const content = parent.ownerDocument.createElement('div');
    el.appendChild(content);
    let cur = props;
    function render(): void {
      setBase(el, cur);
      if (cur.autoStickToEnd) el.scrollTop = el.scrollHeight;
    }
    render();
    parent.appendChild(el);
    return { element: el, contentEl: content, update:(p:ScrollHostProps)=>{cur=p; render();}, dispose:()=>{el.remove();} };
  },
};

export const MediaTile: UIComponent<MediaTileProps> = {
  mount(parent, props, onIntent) {
    void onIntent;
    const doc = parent.ownerDocument;
    const el = doc.createElement('div');
    el.setAttribute('data-mediatype','tile');
    const content = doc.createElement('div');
    el.appendChild(content);
    let cur = props;
    let ownedUrl: string|null = null;
    function render(): void {
      content.innerHTML='';
      // dispose previous owned URL
      if (ownedUrl) { try{URL.revokeObjectURL(ownedUrl);}catch{} ownedUrl=null; }
      el.setAttribute('data-state', cur.state);
      if (cur.state==='available' && cur.media) {
        if (cur.media.kind==='url') {
          const img = doc.createElement('img');
          img.alt = cur.alt;
          img.src = (cur.media as {url:string}).url;
          content.appendChild(img);
        } else if (cur.media.kind==='canvas') {
          content.appendChild((cur.media as {canvas:HTMLCanvasElement}).canvas);
        } else if (cur.media.kind==='native-host') {
          content.appendChild((cur.media as {element:HTMLElement}).element);
        }
      } else {
        const ph = doc.createElement('div');
        ph.textContent = cur.state;
        content.appendChild(ph);
      }
      setBase(el, cur);
    }
    render();
    parent.appendChild(el);
    return {
      element: el, contentEl: content,
      update:(p:MediaTileProps)=>{cur=p; render();},
      dispose:()=>{ if(ownedUrl){try{URL.revokeObjectURL(ownedUrl);}catch{}} el.remove(); },
    };
  },
};
