// Minimal real DOM harness for Node tests (no external deps).
export type MiniEl = {
  tagName: string;
  children: MiniEl[];
  parent: MiniEl | null;
  readonly parentNode: MiniEl | null;
  replaceChildren(...nodes:MiniEl[]): void;
  attributes: Map<string, string>;
  listeners: Map<string, Set<(e: unknown) => void>>;
  textContent: string;
  innerHTMLRaw: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  ownerDocument: MiniDoc;
  style: Record<string, string>;
  scrollTop: number;
  scrollHeight: number;
  type: string;
  min: string;
  max: string;
  multiple: boolean;
  required: boolean;
  files: { length: number } | null;
  [k: string]: unknown;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(c: MiniEl): MiniEl;
  removeChild(c: MiniEl): MiniEl;
  remove(): void;
  addEventListener(t: string, fn: (e: unknown) => void): void;
  removeEventListener(t: string, fn: (e: unknown) => void): void;
  dispatchEvent(e: { type: string } & Record<string, unknown>): void;
  click(): void;
  focus(): void;
  querySelector(sel: string): MiniEl | null;
  readonly childNodes: MiniEl[];
  readonly lastChild: MiniEl | null;
  readonly firstChild: MiniEl | null;
};

export type MiniDoc = {
  body: MiniEl;
  activeElement: MiniEl | null;
  createElement(tag: string): MiniEl;
};

function makeEl(tag: string, doc: MiniDoc): MiniEl {
  const children: MiniEl[] = [];
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const self = {
    tagName: tag.toUpperCase(),
    children,
    parent: null as MiniEl | null,
    attributes,
    listeners,
    textContent: '',
    innerHTMLRaw: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    ownerDocument: doc,
    style: {} as Record<string, string>,
    scrollTop: 0,
    scrollHeight: 0,
    type: '',
    min: '',
    max: '',
    multiple: false,
    required: false,
    files: null as { length: number } | null,
    setAttribute: (k: string, v: string): void => { attributes.set(k, String(v)); },
    getAttribute: (k: string): string | null => (attributes.has(k) ? (attributes.get(k) as string) : null),
    removeAttribute: (k: string): void => { attributes.delete(k); },
    appendChild: (c: MiniEl): MiniEl => { c.parent = el; children.push(c); return c; },
    replaceChildren: (...nodes: MiniEl[]):void => {
      for (const child of children) child.parent=null;
      children.length=0;
      for(const n of nodes)el.appendChild(n);
    },
    removeChild: (c: MiniEl): MiniEl => {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      c.parent = null;
      return c;
    },
    remove: (): void => {
      if (el.parent) el.parent.removeChild(el);
    },
    addEventListener: (t: string, fn: (e: unknown) => void): void => {
      let s = listeners.get(t);
      if (!s) { s = new Set(); listeners.set(t, s); }
      s.add(fn);
    },
    removeEventListener: (t: string, fn: (e: unknown) => void): void => {
      listeners.get(t)?.delete(fn);
    },
    dispatchEvent: (e: { type: string } & Record<string, unknown>): void => {
      const s = listeners.get(e.type);
      if (s) for (const fn of [...s]) fn(e);
    },
    click: (): void => {
      el.dispatchEvent({ type: 'click', preventDefault: () => {} });
    },
    focus: (): void => {
      doc.activeElement = el;
    },
    querySelector: (sel: string): MiniEl | null => {
      const parts = sel.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const q: MiniEl[] = [...children];
      while (q.length) {
        const cur = q.shift();
        if (!cur) break;
        for (const p of parts) {
          if (p.startsWith('[') || cur.tagName.toLowerCase() === p) return cur;
        }
        q.push(...cur.children);
      }
      return null;
    },
  } as unknown as MiniEl;
  const el = self as MiniEl;
  Object.defineProperty(el, 'parentNode', { get: ():MiniEl|null => el.parent, configurable:true });
  Object.defineProperty(el, 'childNodes', { get: (): MiniEl[] => children, configurable: true });
  Object.defineProperty(el, 'lastChild', { get: (): MiniEl | null => (children.length ? (children[children.length - 1] as MiniEl) : null), configurable: true });
  Object.defineProperty(el, 'firstChild', { get: (): MiniEl | null => (children.length ? (children[0] as MiniEl) : null), configurable: true });
  Object.defineProperty(el, 'innerHTML', {
    get: (): string => el.innerHTMLRaw as string,
    set: (v: string): void => {
      (el as unknown as { innerHTMLRaw: string }).innerHTMLRaw = String(v);
      for(const child of children)child.parent=null;
      children.length = 0;
      const s = String(v);
      const re = /<iframe\b[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const ifr = makeEl('iframe', doc);
        (ifr as unknown as Record<string, unknown>)['textToImagePluginOutput'] = undefined;
        el.appendChild(ifr);
      }
    },
    configurable: true,
  });
  return el;
}

export function createMiniDocument(): MiniDoc {
  const doc = {} as MiniDoc;
  doc.activeElement = null;
  doc.createElement = (tag: string): MiniEl => makeEl(tag, doc);
  doc.body = makeEl('body', doc);
  return doc;
}

export function installMiniDom(): MiniDoc {
  const doc = createMiniDocument();
  const g = globalThis as unknown as Record<string, unknown>;
  g['document'] = doc;
  const w = (g['window'] as Record<string, unknown> | undefined) ?? {};
  w['document'] = doc;
  g['window'] = w;
  g['__dom'] = { document: doc };
  g['HTMLElement'] = class {};
  g['HTMLCanvasElement'] = class {};
  g['HTMLIFrameElement'] = class {};
  g['Event'] = class {};
  g['KeyboardEvent'] = class {};
  try {
    const U = (globalThis as unknown as { URL?: { revokeObjectURL?: (u: string) => void } }).URL;
    if (U && !U.revokeObjectURL) U.revokeObjectURL = (): void => {};
  } catch { /* ignore */ }
  return doc;
}

export function createTestHost(doc?: MiniDoc): MiniEl {
  const existing = (globalThis as unknown as { __dom?: { document: MiniDoc } }).__dom?.document;
  const d = doc ?? existing ?? installMiniDom();
  const el = d.createElement('div');
  d.body.appendChild(el);
  return el;
}
