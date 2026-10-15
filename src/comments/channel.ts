// S3-07 channel grammar (v0.3.6 §22.6)
export function validateRoomKey(roomKey: string): boolean {
  if (typeof roomKey !== 'string' || roomKey.length < 1 || roomKey.length > 64) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(roomKey) && !(roomKey.length===1 && /^[a-z0-9]$/.test(roomKey))) {
    if (roomKey.length === 1) return /^[a-z0-9]$/.test(roomKey);
    return false;
  }
  if (!/^[a-z0-9-]+$/.test(roomKey)) return false;
  return true;
}
export function appChannelBase(roomKey: string): string {
  if (!validateRoomKey(roomKey)) throw new Error('ROOM_CHANNEL_INVALID:roomKey');
  return 'plr1-' + roomKey;
}
// Parse full channel: base [+ suffix rules]. Suffix: comma-delimited, ordered ids:/u:/auth:
export function parseChannel(full: string): { base: string; rules: string[] } {
  if (typeof full !== 'string' || !full) throw new Error('ROOM_CHANNEL_INVALID:empty');
  const plus = full.indexOf('+');
  const base = plus === -1 ? full : full.slice(0, plus);
  const suffix = plus === -1 ? '' : full.slice(plus+1);
  if (!base || base.length > 69) throw new Error('ROOM_CHANNEL_INVALID:base');
  // base may be plr1-xxx or existing native like general, general-chat
  if (base.startsWith('plr1-')) {
    const rk = base.slice(5);
    if (!validateRoomKey(rk)) throw new Error('ROOM_CHANNEL_INVALID:roomKey');
  } else {
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(base) && !/^[a-z0-9]$/.test(base)) throw new Error('ROOM_CHANNEL_INVALID:base');
  }
  if (!suffix) return { base, rules: [] };
  const rules = suffix.split(',');
  if (rules.some(r=>!r)) throw new Error('ROOM_CHANNEL_INVALID:empty rule');
  if (new Set(rules).size !== rules.length) throw new Error('ROOM_CHANNEL_INVALID:duplicate rule');
  // order: ids: -> u: -> auth:
  let stage = 0;
  for (const r of rules) {
    if (r.startsWith('ids:')) {
      if (stage > 0) throw new Error('ROOM_CHANNEL_INVALID:order');
      stage = 1;
      const v = r.slice(4);
      if (!v || !/^[a-z0-9-]+$/.test(v)) throw new Error('ROOM_CHANNEL_INVALID:ids');
    } else if (r.startsWith('u:')) {
      if (stage > 1) throw new Error('ROOM_CHANNEL_INVALID:order');
      stage = 2;
      const users = r.slice(2).split('|');
      if (users.length > 16 || users.some(u=>!u || !/^[a-z0-9-]+$/.test(u))) throw new Error('ROOM_CHANNEL_INVALID:users');
      if (new Set(users).size !== users.length) throw new Error('ROOM_CHANNEL_INVALID:dup users');
    } else if (r.startsWith('auth:')) {
      stage = 3;
      const v = r.slice(5);
      if (!/^[0-9a-f]{64}$/.test(v)) throw new Error('ROOM_CHANNEL_INVALID:auth');
    } else throw new Error('ROOM_CHANNEL_INVALID:unknown rule');
  }
  return { base, rules };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
