// S3-03 bootstrap sentinel + composition (v0.3.6 §6.3-6.5)
// Thin inline classic sentinel first; module composition with build IDs; owned failure handling.

export type BootCode = 'BOOT_ASSET_UNAVAILABLE' | 'BOOT_TIMEOUT' | 'BOOT_BUILD_MISMATCH' | 'BOOT_APP_EXCEPTION' | 'PREVIEW_SW_UNAVAILABLE';
export type BootState = 'waiting' | 'ready' | 'failed';
export interface BootSentinel { readonly buildId: string; readonly state: BootState; markReady(args: {buildId: string; rootId: 'app-root'}): void; fail(args: {code: BootCode; assetPath?: string}): void; }
declare global { interface Window { __pcBoot?: BootSentinel } }

export interface SentinelConfig { buildId: string; modulePath: string; stylePath: string; timeoutMs?: number; }

export function buildSentinelHtml(cfg: SentinelConfig): string {
  const timeout = cfg.timeoutMs ?? 2500;
  const esc = (s: string): string => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // Classic inline sentinel: no imports, no PJS brackets, ordinary {} permitted.
  return '<scr'+'ipt>\n' +
  "(function(){'use strict';var buildId='"+esc(cfg.buildId)+"',state='waiting',issues=[],wrote=false;\n" +
  "var owned={'module':'"+esc(cfg.modulePath)+"','style':'"+esc(cfg.stylePath)+"'};\n" +
  "var timer=null;\n" +
  "function ui(code){var e=document.getElementById('app-root');if(!e){issues.push(code);return;}e.textContent='Stage 3 bootstrap: '+code;e.setAttribute('role','alert');wrote=true;}\n" +
  "function fail(args){if(state!=='waiting')return;state='failed';if(timer)clearTimeout(timer);ui(args.code);}\n" +
  "function markReady(args){if(state!=='waiting')return;if(args.buildId!==buildId||args.rootId!=='app-root'){fail({code:'BOOT_BUILD_MISMATCH'});return;}state='ready';if(timer)clearTimeout(timer);try{window.removeEventListener('error',onError,true);}catch(e){}try{window.removeEventListener('unhandledrejection',onRejection);}catch(e){}}\n" +
  "function onError(ev){if(state!=='waiting')return;var el=ev.target;if(el&&el.getAttribute){var t=el.getAttribute('data-pc-boot-asset');if(t&&Object.prototype.hasOwnProperty.call(owned,t)){var url=el.getAttribute(t==='module'?'src':'href');if(url===owned[t]){var sw=false;try{sw=(window.generatorIsUnsaved===true&&!('serviceWorker' in navigator));}catch(e){}fail({code:sw?'PREVIEW_SW_UNAVAILABLE':'BOOT_ASSET_UNAVAILABLE'});}}}if(ev.filename&&String(ev.filename).indexOf('"+esc(cfg.buildId)+"')!==-1){fail({code:'BOOT_APP_EXCEPTION'});}}\n" +
  "function onRejection(ev){void ev;}\n" +
  "try{window.addEventListener('error',onError,true);}catch(e){}\n" +
  "try{window.addEventListener('unhandledrejection',onRejection);}catch(e){}\n" +
  "try{window.__pcBoot={buildId:buildId,get state(){return state;},markReady:markReady,fail:fail};}catch(e){}\n" +
  "timer=setTimeout(function(){fail({code:'BOOT_TIMEOUT'});},"+String(Math.max(500, Math.min(10000, timeout)))+");\n" +
  "document.addEventListener('DOMContentLoaded',function(){if(issues.length&&!wrote)ui(issues[0]);},{once:true});\n" +
  "})();\n" +
  '</scr'+'ipt>';
}

export function buildIndexHtml(cfg: SentinelConfig, appInnerHtml = ''): string {
  const sentinel = buildSentinelHtml(cfg);
  const esc = (s: string): string => s.replace(/"/g,'&quot;');
  return sentinel + '\n<div id="app-root">' + (appInnerHtml || 'Starting…') + '</div>\n' +
    '<link data-pc-boot-asset="style" rel="stylesheet" href="'+esc(cfg.stylePath)+'">\n' +
    '<scr'+'ipt data-pc-boot-asset="module" type="module" src="'+esc(cfg.modulePath)+'"></scr'+'ipt>';
}

export interface CompositionConfig { buildId: string; previousBuildId: string | null; generatorSlug: string; selectedProfiles: string[]; }
export interface CompositionResult { mainPjs: string; manifestImports: Array<{alias:string; importName:string}>; buildInfo: {buildId:string; previousBuildId:string|null; generatorSlug:string} }

import { composeImports } from './linter.js';

export function composePackage(cfg: CompositionConfig): CompositionResult {
  const { lines } = composeImports(cfg.selectedProfiles);
  const mainPjs = lines.join('\n') + (lines.length ? '\n' : '');
  const manifestImports = lines.map(ln => {
    const m = /^([^ ]+) = \{import:([^}]+)\}$/.exec(ln);
    if (!m) throw new Error('compose produced invalid line');
    const alias: string | undefined = m[1];
    const importName: string | undefined = m[2];
    if (alias === undefined || importName === undefined) throw new Error('compose produced invalid line');
    return { alias, importName };
  });
  return { mainPjs, manifestImports, buildInfo: { buildId: cfg.buildId, previousBuildId: cfg.previousBuildId, generatorSlug: cfg.generatorSlug } };
}

export function classifyBootError(ev: { owned: boolean; kind: 'resource'|'runtime'|'timeout'|'sw'|'mismatch' }): BootCode | null {
  if (!ev.owned) return null;
  if (ev.kind === 'resource') return 'BOOT_ASSET_UNAVAILABLE';
  if (ev.kind === 'runtime') return 'BOOT_APP_EXCEPTION';
  if (ev.kind === 'timeout') return 'BOOT_TIMEOUT';
  if (ev.kind === 'sw') return 'PREVIEW_SW_UNAVAILABLE';
  if (ev.kind === 'mismatch') return 'BOOT_BUILD_MISMATCH';
  return null;
}
