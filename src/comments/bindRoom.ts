// S3-07 RoomTransportPort — two modes, one-shot setters, settlement vs delivery (v0.3.6 §22.6)
import { ok, err, type Outcome } from '../core/outcome.js';
import { parseChannel, escapeHtml } from './channel.js';

export type RoomMessage = { localId: string; bodyUnsafe: string; rawTime?: unknown; replyingTo?: unknown; byCurrentUser?: boolean; sender?: { id?: string; visualId?: string; nickname?: string; isAdmin?: boolean } };
export type RoomSubmission = { kind: 'invoked' | 'unknown' | 'error'; localOperationId: string; error?: { code: string; safeMessage: string; recoverability: 'retry_user' | 'reconcile' | 'none' } };
export type RoomMount = { channel: string; host: unknown; presentation: 'native' | 'custom-qualified'; hideComments?: boolean | undefined; width?: string | number | undefined; height?: number | undefined; beforeSubmit?: ((text: string) => string | null | undefined) | undefined };
export type RoomHandle = {
  submit(text: string, opts?: { nickname?: string; avatarUrl?: string }): Promise<RoomSubmission>;
  disposeHost(): void;
  // Test/integration seam: deliver native-side events into the fenced projection.
  dispatchInitial(xs: RoomMessage[]): void;
  dispatchMessage(x: RoomMessage): void;
  readonly channel: string;
};

export interface NativeRoomInstance {
  setNicknameForNextComment?(name: string): void;
  setAvatarUrlForNextComment?(url: string): void;
  submit?(text: string): void;
  // Optional native event wiring: if the native instance supports hooks, binder connects them.
  setHooks?(hooks: { onInitial: (xs: RoomMessage[]) => void; onMessage: (x: RoomMessage) => void }): void;
  toString(): string;
}

let opCounter = 0;
let instanceCounter = 0;

export function createRoomBinder(nativeFactory: (channel: string, opts: Record<string, unknown>) => NativeRoomInstance) {
  let activeToken = 0;
  return {
    mount(cfg: RoomMount, hooks: { onInitial: (xs: RoomMessage[]) => void; onMessage: (x: RoomMessage) => void }): Outcome<RoomHandle> {
      try { parseChannel(cfg.channel); } catch { return err('ROOM_CHANNEL_INVALID', 'bad channel'); }
      if (!cfg.host || typeof (cfg.host as { appendChild?: unknown }).appendChild !== 'function') return err('ROOM_NOT_READY', 'bad host');
      if (cfg.presentation !== 'native' && cfg.presentation !== 'custom-qualified') return err('BAD_INPUT', 'presentation');
      const token = ++instanceCounter;
      activeToken = token;
      let disposed = false;
      let quarantined = false;
      let queue: Promise<unknown> = Promise.resolve();
      const seenIds = new Set<string>();
      // Native callbacks have no authenticated unique message ID. IDs below are
      // projection-local fingerprints ONLY, never delivery acknowledgments.
      function adapt(raw: unknown): RoomMessage | null {
        if (!raw || typeof raw !== 'object') return null;
        const x = raw as Record<string, unknown>;
        const user = (x['user'] && typeof x['user'] === 'object') ? x['user'] as Record<string,unknown> : {};
        const bodyUnsafe = typeof x['message'] === 'string' ? x['message'] : typeof x['bodyUnsafe'] === 'string' ? x['bodyUnsafe'] : null;
        if (bodyUnsafe === null) return null;
        const key = [String(x['time'] ?? ''),String(user['id'] ?? ''),bodyUnsafe,String(x['replyingTo'] ?? '')].join('\u001f');
        let h=2166136261;for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}
        const id = typeof x['localId'] === 'string' ? x['localId'] : 'room-message-'+(h>>>0).toString(16);
        const sender: NonNullable<RoomMessage['sender']> = {};
        if(typeof user['id']==='string')sender.id=user['id'];
        if(typeof user['visualId']==='string')sender.visualId=user['visualId'];
        if(typeof user['nickname']==='string')sender.nickname=user['nickname'];
        if(typeof user['isAdmin']==='boolean')sender.isAdmin=user['isAdmin'];
        return {localId:id,bodyUnsafe,rawTime:x['time'],replyingTo:x['replyingTo'],byCurrentUser:x['byCurrentUser']===true,sender};
      }
      function fencedInitial(xs: RoomMessage[]): void {
        if(disposed||token!==activeToken)return;
        const out: RoomMessage[]=[];
        for(const raw of xs){const m=adapt(raw);if(!m||seenIds.has(m.localId))continue;seenIds.add(m.localId);out.push(m);}
        try{hooks.onInitial(out);}catch{/* consumer isolated */}
      }
      function fencedMessage(raw: RoomMessage): void {
        if(disposed||token!==activeToken)return;
        const m=adapt(raw);if(!m||seenIds.has(m.localId))return;
        seenIds.add(m.localId);
        try{hooks.onMessage(m);}catch{/* consumer isolated */}
      }
      let native: NativeRoomInstance;
      try {
        const opts: Record<string, unknown> = {
          channel: cfg.channel,
          onLoad: (raw: unknown) => fencedInitial(Array.isArray(raw) ? raw as RoomMessage[] : []),
          onComment: (raw: unknown) => {if(raw&&typeof raw==='object')fencedMessage(raw as RoomMessage);},
        };
        if (cfg.presentation === 'native' && cfg.beforeSubmit) opts['beforeSubmit'] = cfg.beforeSubmit;
        if (cfg.hideComments !== undefined) opts['hideComments'] = cfg.hideComments;
        if (cfg.width !== undefined) opts['width'] = cfg.width;
        if (cfg.height !== undefined) opts['height'] = cfg.height;
        native = nativeFactory(cfg.channel, opts);
      } catch { return err('ROOM_NOT_READY', 'factory threw'); }
      if (!native || typeof native.toString !== 'function') return err('ROOM_NOT_READY', 'bad native instance');
      // Mount the ACTUAL native iframe HTML (never stringify-and-discard).
      try {
        const host = cfg.host as HTMLElement;
        const html = String(native.toString());
        if (!html) return err('ROOM_MOUNT_UNQUALIFIED', 'empty native html');
        try { host.innerHTML = ''; } catch { return err('ROOM_MOUNT_UNQUALIFIED', 'clear host'); }
        const doc = host.ownerDocument;
        if (doc && typeof doc.createElement === 'function') {
          const wrap = doc.createElement('div');
          try {
            wrap.setAttribute('data-room-channel', cfg.channel);
            wrap.setAttribute('data-room-presentation', cfg.presentation);
            // Real mount: insert native HTML so the iframe actually loads.
            wrap.innerHTML = html;
            host.appendChild(wrap);
          } catch { return err('ROOM_MOUNT_UNQUALIFIED', 'insert html'); }
        } else {
          // Host without ownerDocument (minimal test host): still record channel + html.
          try {
            host.setAttribute('data-room-channel', cfg.channel);
            host.setAttribute('data-room-presentation', cfg.presentation);
            void html;
            // Attempt innerHTML mount for hosts that support it.
            try { (host as unknown as { innerHTML: string }).innerHTML = html; } catch { /* ignore */ }
          } catch { return err('ROOM_MOUNT_UNQUALIFIED', 'mount failed'); }
        }
      } catch { return err('ROOM_MOUNT_UNQUALIFIED', 'mount failed'); }

      async function submit(text: string, opts?: { nickname?: string; avatarUrl?: string }): Promise<RoomSubmission> {
        const localOperationId = 'room-' + (++opCounter);
        if (disposed || token !== activeToken) return { kind: 'error', localOperationId, error: { code: 'ROOM_NOT_READY', safeMessage: 'disposed', recoverability: 'none' } };
        if (quarantined) return { kind: 'error', localOperationId, error: { code: 'ROOM_IDENTITY_UNCERTAIN', safeMessage: 'quarantined, reconstruct', recoverability: 'reconcile' } };
        if (cfg.presentation === 'native') return { kind: 'error', localOperationId, error: { code: 'ROOM_NOT_READY', safeMessage: 'native composer only', recoverability: 'none' } };
        if (typeof text !== 'string' || !text.trim()) return { kind: 'error', localOperationId, error: { code: 'BAD_INPUT', safeMessage: 'empty', recoverability: 'none' } };
        if (text.length > 4000) return { kind: 'error', localOperationId, error: { code: 'BAD_INPUT', safeMessage: 'too long', recoverability: 'none' } };
        let out: string | null | undefined = text;
        if (cfg.beforeSubmit) {
          try { out = cfg.beforeSubmit(text); } catch { return { kind: 'error', localOperationId, error: { code: 'ROOM_SUBMIT_FAILED', safeMessage: 'presubmit threw', recoverability: 'none' } }; }
          if (out === null) return { kind: 'error', localOperationId, error: { code: 'ROOM_SUBMIT_FAILED', safeMessage: 'cancelled', recoverability: 'none' } };
          if (out === undefined) out = text;
        }
        const finalText: string = out as string;
        const nick = opts?.nickname;
        const avatar = opts?.avatarUrl;
        if (nick !== undefined && (typeof nick !== 'string' || !nick.trim() || nick.length > 64)) return { kind: 'error', localOperationId, error: { code: 'BAD_INPUT', safeMessage: 'nickname', recoverability: 'none' } };
        if (avatar !== undefined && (typeof avatar !== 'string' || !avatar.trim() || avatar.length > 2048)) return { kind: 'error', localOperationId, error: { code: 'BAD_INPUT', safeMessage: 'avatar', recoverability: 'none' } };
        // Missing native submit() is a REAL error — never fabricate invoked.
        if (typeof native.submit !== 'function') {
          return { kind: 'error', localOperationId, error: { code: 'ROOM_SUBMIT_FAILED', safeMessage: 'no native submit', recoverability: 'retry_user' } };
        }
        const run = async (): Promise<RoomSubmission> => {
          let armed = false;
          try {
            if (nick !== undefined) { native.setNicknameForNextComment?.(nick); armed = true; }
            if (avatar !== undefined) { native.setAvatarUrlForNextComment?.(avatar); armed = true; }
          } catch {
            quarantined = true;
            return { kind: 'error', localOperationId, error: { code: 'ROOM_IDENTITY_UNCERTAIN', safeMessage: 'setter failed, quarantined', recoverability: 'reconcile' } };
          }
          try {
            native.submit?.(finalText);
          } catch {
            if (armed) quarantined = true;
            return { kind: 'error', localOperationId, error: { code: 'ROOM_SUBMIT_FAILED', safeMessage: 'submit threw', recoverability: 'retry_user' } };
          }
          if (disposed || token !== activeToken) {
            return { kind: 'unknown', localOperationId };
          }
          return { kind: 'invoked', localOperationId };
        };
        // Only BEGIN the native operation when the predecessor has settled.
        const submitted = queue.then(run, run);
        queue = submitted.then(() => undefined, () => undefined);
        return submitted;
      }

      void escapeHtml;
      return ok({
        submit,
        disposeHost: () => { disposed = true; try { (cfg.host as HTMLElement).innerHTML = ''; } catch { /* ignore */ } },
        dispatchInitial: fencedInitial,
        dispatchMessage: fencedMessage,
        channel: cfg.channel,
      });
    },
  };
}

export function renderMessageSafe(m: RoomMessage): string {
  return escapeHtml(m.bodyUnsafe);
}
