# Getting started

## Prerequisites

Use Node >=20 to **build**. Install from a checked-out repo with `npm ci && npm run verify` and `npm pack`; install the generated local `.tgz` in the consuming project's build environment. No registry publication is assumed.

## Explicit capability injection

```ts
import { DraftStore, type DomainDef, type KvFolderLike } from 'perch-complete-library/storage';
import { bindText, type NativeBackend } from 'perch-complete-library/text';

type Domains = { settings: { theme: string } };
const definition: DomainDef<Domains['settings']> = {
  folder: 'settings', schemaMajor: 1,
  validate: (v: unknown): v is Domains['settings'] =>
    typeof v === 'object' && v !== null && typeof (v as {theme?: unknown}).theme === 'string'
};

// App-owned native capability; caller MUST provide a real KV folder.
declare const getFolder: (name: string) => KvFolderLike;
const store = new DraftStore<Domains>(getFolder, {settings: definition});
const saved = await store.commit('settings', 'personal', null, {theme: 'dark'});
if (saved.kind !== 'ok') throw new Error(saved.kind === 'error' ? saved.error.code : saved.kind);

declare const nativeText: NativeBackend;
const text = bindText(nativeText); // No provider call until explicit request.
void text;
```

## Perchance boundary

Select native plugins explicitly in the generator's `main.pjs` using `composeImports`/approved native profiles. Pass the selected aliases to app-owned adapters. Do not import plugins dynamically, depend on CDN script hosting, or presume arbitrary `root` aliases exist. See [Native bindings](guides/native-bindings.md).

## Build-time assembly

`/build` offers `composePackage()`, linter APIs and `assemble()`. The assembler expects an **already-bundled** JS asset and style bytes and constructs a validated static package. It is not an application bundler. Use a standard build-time bundler in the application workspace, then publish its local assets. See [Build assets](guides/build-assets.md).
