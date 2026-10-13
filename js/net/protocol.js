// Wire format shared by the P2P host and a future dedicated server.
// Messages are plain objects { t: TYPE, ... }; hot paths (player and titan state)
// are packed into flat number arrays to keep packets small.

export const T = {
  HELLO: 'hello',     // c->a {name, v}
  WELCOME: 'welcome', // a->c {id, players, phase, mission}
  REJECT: 'reject',   // a->c {reason}
  LOBBY: 'lobby',     // a->c {players, mission}
  START: 'start',     // a->c {mission}
  PS: 'ps',           // c->a own state (packed)
  PSS: 'pss',         // a->c everyone's state [[id, ...packed]]
  TI: 'ti',           // a->c titans [[...packed]]
  ACT: 'act',         // c->a combat action {k, ...}
  RES: 'res',         // a->c outcome of *your* action
  EV: 'ev',           // a->c something everyone should see (blood, feed line)
  HURT: 'hurt',       // a->c you were hit {dmg, from}
  GRAB: 'grab',       // a->c a titan grabbed you {tid}
  BOARD: 'sb',        // a->c scoreboard + mission status
  END: 'end',         // a->c mission over {win, reason}
  CHAT: 'chat',       // both ways {from, msg}
  BYE: 'bye',         // a->c room closed
};

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

const HOOK = { none: 0, flying: 1, attached: 2, miss: 3 };
const HOOK_NAMES = ['none', 'flying', 'attached', 'miss'];

// ---------- player ----------
export function packPlayer(s) {
  const a = s.anim, q = s.m.root.quaternion;
  const flags = (a.air ? 1 : 0) | (a.spin ? 2 : 0) | (s.dead ? 4 : 0) | (s.charged ? 8 : 0) | (s.boosting ? 16 : 0) | (s.braking ? 32 : 0) | (s.reeling ? 64 : 0);
  const out = [r2(s.pos.x), r2(s.pos.y), r2(s.pos.z), r2(s.vel.x), r2(s.vel.y), r2(s.vel.z),
    r3(s.facing), r3(q.x), r3(q.y), r3(q.z), r3(q.w), flags, r2(a.run), r2(a.fly || 0), r2(a.slash), a.slashDir || 1,
    r2(s.auraK), Math.round(s.hp), s.grabbedBy ? s.grabbedBy.id : 0];
  for (const h of s.hooks) out.push(HOOK[h.state] ?? 0, r2(h.tip.x), r2(h.tip.y), r2(h.tip.z));
  return out;
}

export function unpackPlayer(p) {
  const f = p[11];
  return {
    pos: [p[0], p[1], p[2]], vel: [p[3], p[4], p[5]], facing: p[6], quat: [p[7], p[8], p[9], p[10]],
    air: !!(f & 1), spin: !!(f & 2), dead: !!(f & 4), charged: !!(f & 8), boost: !!(f & 16), brake: !!(f & 32), reel: !!(f & 64),
    run: p[12], fly: p[13], slash: p[14], slashDir: p[15], aura: p[16], hp: p[17], grabbed: p[18],
    hooks: [[HOOK_NAMES[p[19]], p[20], p[21], p[22]], [HOOK_NAMES[p[23]], p[24], p[25], p[26]]],
  };
}

// ---------- titan ----------
const STATE = { walk: 0, attack: 1, hold: 2, dead: 3 };
const STATE_NAMES = ['walk', 'attack', 'hold', 'dead'];

export function packTitan(t) {
  const a = t.anim;
  const flags = (t.down ? 1 : 0) | (t.blindT > 0 ? 2 : 0) | (t.limp.L > 0 ? 4 : 0) | (t.limp.R > 0 ? 8 : 0)
    | (t.legCut.L > 0 ? 16 : 0) | (t.legCut.R > 0 ? 32 : 0) | (t.warn.visible ? 64 : 0) | (t.abnormal ? 128 : 0) | (t.ally ? 256 : 0) | (t.boss ? 512 : 0) | (t.steamT > 0 ? 1024 : 0);
  return [t.id, r2(t.height), r2(t.pos.x), r2(t.pos.y + t.jumpY + (t.riseY || 0)), r2(t.pos.z), r3(t.yaw), STATE[t.state] ?? 0,
    r2(a.attack || 0), a.attackArm === 'L' ? 0 : 1, r2(a.attackAngle || 2.1), flags, r2(a.phase), r2(a.run), r2(a.lean || 0), r2(t.stagger)];
}

export function unpackTitan(p) {
  const f = p[10];
  return {
    id: p[0], height: p[1], pos: [p[2], p[3], p[4]], yaw: p[5], state: STATE_NAMES[p[6]], attack: p[7], arm: p[8] ? 'R' : 'L',
    angle: p[9], down: !!(f & 1), blind: !!(f & 2), limpL: !!(f & 4), limpR: !!(f & 8), legL: !!(f & 16), legR: !!(f & 32),
    warn: !!(f & 64), abnormal: !!(f & 128), ally: !!(f & 256), boss: !!(f & 512), steam: !!(f & 1024), phase: p[11], run: p[12], lean: p[13], stagger: p[14],
  };
}

export const vec = (v) => [r2(v.x), r2(v.y), r2(v.z)];
