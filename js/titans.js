// AI titans: wander, chase, grab, stagger, lose body parts, die in a cloud of steam.
// Allied titans (summoned in titan mode) hunt scouts instead of the player.
import * as THREE from 'three';
import { buildTitan, animateTitan } from './models.js';
import { WALLZ, W, D, GATE_X0, GATE_X1 } from './world.js';
import { audio } from './audio.js';
import { angleDiff, rand } from './util.js';
import { NET } from './net/config.js';

let SEED = 1;
let warnTex = null;
function warnTexture() {
  if (warnTex) return warnTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#e0302a'; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
  x.lineWidth = 4; x.strokeStyle = '#fff'; x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 42px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', 32, 34);
  warnTex = new THREE.CanvasTexture(c);
  return warnTex;
}
const REGEN = { eyes: 7, arm: 12, leg: 9 };

export class Titan {
  constructor(game, { height, abnormal = false, x, z, ally = false, id = null, puppet = false }) {
    this.game = game;
    this.id = id ?? ++SEED;
    this.puppet = puppet; // driven by network snapshots instead of AI
    this.height = height;
    this.abnormal = abnormal;
    this.ally = ally;
    // the look is derived from the id so every player sees the same titan
    const look = (this.id * 2654435761) >>> 0;
    this.m = buildTitan(height, this.id * 7919, { bigHead: abnormal && look % 5 < 3, longArms: abnormal, thin: abnormal });
    this.netBuf = [];
    this.m.root.rotation.order = 'YXZ';
    for (const mesh of this.m.meshes) mesh.userData.titan = this;
    game.scene.add(this.m.root);
    // red "!" above the head while winding up an attack
    this.warn = new THREE.Sprite(new THREE.SpriteMaterial({ map: warnTexture(), depthTest: false, transparent: true }));
    this.warn.scale.setScalar(Math.max(1.6, height * 0.16));
    this.warn.visible = false;
    game.scene.add(this.warn);
    this.pos = new THREE.Vector3(x, game.world.groundY(x, z), z);
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = abnormal ? rand(6.5, 8.5) : 1.6 + height * 0.13;
    if (ally) this.speed *= 1.6;
    this.turnRate = abnormal || ally ? 2.6 : 1.1;
    this.state = 'walk';
    this.t = 0; this.cool = 0; this.stagger = 0; this.dead = false; this.deadT = 0;
    this.blindT = 0; this.limp = { L: 0, R: 0 }; this.legCut = { L: 0, R: 0 }; this.downT = 0;
    this.attackArm = 'R';
    this.anim = { phase: Math.random() * 6, run: 0, attack: 0, attackArm: 'R', lean: 0 };
    this.wander = this.pickWander();
    this.lastStep = 0;
    this.radius = height * 0.18;
    this.jumpV = 0; this.jumpY = 0;
  }

  pickWander() {
    if (this.ally) return new THREE.Vector3(rand(10, W - 10), 0, rand(10, D - 10));
    if (this.game.world.def.breached && Math.random() < 0.45) return new THREE.Vector3(rand(10, W - 10), 0, rand(8, WALLZ - 8));
    const p = this.game.world.randomOutside(Math.random, WALLZ + 12);
    return new THREE.Vector3(p.x, 0, p.z);
  }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get down() { return this.downT > 0; }

  napeWorld(out = new THREE.Vector3()) {
    const px = this.m.px;
    return this.m.neck.localToWorld(out.set(0, -0.5 * px, -2.6 * px));
  }
  eyesWorld(out = new THREE.Vector3()) {
    const px = this.m.px;
    return this.m.neck.localToWorld(out.set(0, 4.5 * px, 4.2 * px));
  }

  // The thing this titan wants to eat: the nearest soldier (local or remote), or for allies a scout.
  victim() {
    const g = this.game;
    if (!this.ally) {
      let best = null, bd = Infinity;
      for (const v of g.titanTargets()) {
        const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) return null;
      return { pos: best.pos, chest: best.chest, hit: (dmg) => best.hit(dmg, this), grab: () => best.grab(this) };
    }
    let best = null, bd = 90;
    for (const s of g.scouts) {
      if (s.dead) continue;
      const d = Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z);
      if (d < bd && s.pos.y < this.pos.y + this.height * 1.3) { bd = d; best = s; }
    }
    if (!best) return null;
    return { pos: best.pos, chest: best.pos.clone().setY(best.pos.y + 1), hit: () => g.killScout(best, 'ZJEDZONY') };
  }

  // Network: newest authoritative state for a puppet titan.
  pushNet(s, now) {
    this.netBuf.push({ t: now, s });
    if (this.netBuf.length > 20) this.netBuf.shift();
    this.lastNet = now;
  }

  updatePuppet(dt) {
    const g = this.game, now = g.netTime();
    const rt = now - NET.interpDelay;
    const buf = this.netBuf;
    if (!buf.length) return;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) if (buf[i].t <= rt && buf[i + 1].t >= rt) { a = buf[i]; b = buf[i + 1]; break; }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    const s = b.s, sa = a.s;
    this.pos.set(sa.pos[0] + (s.pos[0] - sa.pos[0]) * k, sa.pos[1] + (s.pos[1] - sa.pos[1]) * k, sa.pos[2] + (s.pos[2] - sa.pos[2]) * k);
    this.yaw = sa.yaw + angleDiff(sa.yaw, s.yaw) * k;
    this.state = s.state; this.attackArm = s.arm; this.stagger = s.stagger;
    this.blindT = s.blind ? 1 : 0; this.downT = s.down ? 1 : 0;
    this.limp.L = s.limpL ? 1 : 0; this.limp.R = s.limpR ? 1 : 0; this.legCut.L = s.legL ? 1 : 0; this.legCut.R = s.legR ? 1 : 0;
    const an = this.anim;
    an.attack = s.attack; an.attackArm = s.arm; an.attackAngle = s.angle; an.run = s.run; an.lean = s.lean;
    an.phase = sa.phase + (s.phase - sa.phase) * k;
    an.kneel = s.down; an.blind = this.blindT; an.limpL = s.limpL; an.limpR = s.limpR;
    const sink = s.down ? -10 * this.m.px : 0;
    this.m.root.position.set(this.pos.x, this.pos.y + sink, this.pos.z);
    this.m.root.rotation.y = this.yaw;
    animateTitan(this.m, an);
    this.m.armL.scale.y = s.limpL ? 0.35 : 1;
    this.m.armR.scale.y = s.limpR ? 0.35 : 1;
    this.m.root.updateMatrixWorld(true);
    this.warn.visible = s.warn;
    if (s.warn) this.warn.position.copy(this.pos).setY(this.pos.y + this.height * 1.15 + 1.5);
    this.m.skin.emissive.setRGB(s.warn ? 0.35 + 0.25 * Math.sin(g.time * 30) : 0, 0, 0);
    if (Math.random() < dt * 6) this.steamInjuries();
    const stepIdx = Math.floor(an.phase / Math.PI);
    if (stepIdx !== this.lastStep && an.run > 0.05) {
      this.lastStep = stepIdx;
      const vv = this.vol();
      if (vv > 0.05) { audio.play('step', vv * Math.min(1, this.height / 12)); g.shake(0.12 * vv * this.height / 15); }
    }
  }

  update(dt) {
    const g = this.game;
    if (this.dead) return this.updateDead(dt);
    if (this.puppet) return this.updatePuppet(dt);
    const v = this.victim();
    const target = new THREE.Vector3();
    let chasing = false;
    const dP = v ? Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) : Infinity;
    const aggro = this.ally ? 200 : this.abnormal ? 90 : 55;

    // injuries heal over time
    this.blindT = Math.max(0, this.blindT - dt);
    this.downT = Math.max(0, this.downT - dt);
    for (const k of ['L', 'R']) { this.limp[k] = Math.max(0, this.limp[k] - dt); this.legCut[k] = Math.max(0, this.legCut[k] - dt); }
    if (this.legCut.L > 0 && this.legCut.R > 0 && this.downT <= 0) { this.downT = 6; this.state = 'walk'; this.anim.attack = 0; audio.play('thud', this.vol() * 0.8); g.shake(0.5 * this.vol()); }
    if (Math.random() < dt * 6) this.steamInjuries();

    if (this.blindT > 0) {
      if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 6) this.wander = this.pickWander();
      target.copy(this.wander);
    } else if (!this.ally && g.mission && g.mission.titanGoal === 'gate' && dP > 30) {
      target.set((GATE_X0 + GATE_X1) / 2 + Math.sin(this.wander.x) * 6, 0, WALLZ + 4);
    } else if (dP < aggro) {
      target.set(v.pos.x, 0, v.pos.z); chasing = true;
    } else if (this.ally && g.titanPlayer && !g.titanPlayer.dead) {
      target.set(g.titanPlayer.pos.x + 12, 0, g.titanPlayer.pos.z + 12);
    } else {
      if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 6) this.wander = this.pickWander();
      target.copy(this.wander);
    }

    // breached wall: anything inside the district is reached through the hole in the gate
    const gateX = (GATE_X0 + GATE_X1) / 2 + 0.5;
    if (g.world.def.breached && !this.ally && target.z < WALLZ && this.pos.z > WALLZ + 2 && Math.abs(this.pos.x - gateX) > 4) target.set(gateX, 0, WALLZ + 6);
    this.cool = Math.max(0, this.cool - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    let moveSpeed = 0;
    const canAttack = this.blindT <= 0 && this.stagger <= 0 && !(this.limp.L > 0 && this.limp.R > 0);

    if (this.state === 'walk') {
      const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
      const turn = this.down ? this.turnRate * 0.4 : this.turnRate;
      this.yaw += Math.max(-turn * dt, Math.min(turn * dt, angleDiff(this.yaw, want)));
      const distT = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
      if (this.stagger <= 0 && !this.down && distT > this.height * 0.3) {
        moveSpeed = this.speed * (chasing ? 1.25 : 0.7) * (this.blindT > 0 ? 0.4 : 1);
        if (this.legCut.L > 0 || this.legCut.R > 0) moveSpeed *= 0.45;
      }

      // grab when the victim is in reach and in front
      if (v && this.cool <= 0 && canAttack) {
        const reach = this.height * 0.5 + 2.5;
        const dy = v.pos.y - this.pos.y;
        if (dP < reach && dy < this.height * (this.down ? 0.8 : 1.15) && dy > -2) {
          const fwd = this.forward();
          const dir = new THREE.Vector3(v.pos.x - this.pos.x, 0, v.pos.z - this.pos.z).normalize();
          if (fwd.dot(dir) > 0.15) {
            let arm = fwd.x * dir.z - fwd.z * dir.x > 0 ? 'L' : 'R';
            if (this.limp[arm] > 0) arm = arm === 'L' ? 'R' : 'L';
            this.state = 'attack'; this.t = 0;
            this.attackArm = arm;
            this.anim.attackArm = arm;
            // aim the arm at the victim: 0 = hanging down, PI/2 = straight ahead, PI = overhead
            const shoulderY = this.pos.y + this.height * (this.down ? 0.45 : 0.72);
            const ang = Math.atan2(Math.max(1, dP - this.height * 0.1), shoulderY - (v.pos.y + 1));
            this.anim.attackAngle = Math.max(0.5, Math.min(2.9, ang + (ang < 1.2 ? 0.25 : 0)));
            this.hasHit = false;
            audio.play('swipe', this.vol());
            if (Math.random() < 0.3) audio.play('roar', this.vol() * 0.8);
          }
        }
      }
      // abnormals leap at you
      if (this.abnormal && chasing && !this.down && this.jumpY === 0 && dP < 26 && dP > 10 && Math.random() < dt * 0.4) this.jumpV = 14;
    } else if (this.state === 'attack') {
      this.t += dt;
      const dur = this.abnormal ? 0.8 : 1.1;
      if (v && this.t < dur * 0.4) {
        const want = Math.atan2(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
        this.yaw += Math.max(-1.5 * dt, Math.min(1.5 * dt, angleDiff(this.yaw, want)));
      }
      this.anim.attack = Math.min(1, this.t / dur);
      if (!this.hasHit && this.t > dur * 0.55 && v) {
        this.hasHit = true;
        const arm = this.attackArm === 'L' ? this.m.armL : this.m.armR;
        const sh = arm.getWorldPosition(new THREE.Vector3());
        const hand = arm.localToWorld(new THREE.Vector3(0, -14 * this.m.px, 0));
        const c = new THREE.Line3(sh, hand).closestPointToPoint(v.chest, true, new THREE.Vector3());
        if (c.distanceTo(v.chest) < this.height * 0.16 + 1.6 + (this.ally ? 2 : 0)) {
          if (v.grab && Math.random() < 0.55) { v.grab(); this.state = 'hold'; this.t = 0; this.holdStart = g.time; }
          else v.hit(28 + this.height * 1.4);
        }
      }
      if (this.state === 'hold') { /* switched above */ }
      if (this.state === 'attack' && (this.t >= dur || this.blindT > 0 || this.limp[this.attackArm] > 0)) { this.state = 'walk'; this.anim.attack = 0; this.cool = this.abnormal ? 0.6 : 1.4; }
    } else if (this.state === 'hold') {
      // holding the soldier up towards the mouth
      this.anim.attack = 0.6; this.anim.attackAngle = 2.3;
      if (!g.isHeldBy(this)) { this.state = 'walk'; this.anim.attack = 0; this.cool = 2; }
    }
    const winding = this.state === 'attack' && this.t < (this.abnormal ? 0.8 : 1.1) * 0.55;
    this.warn.visible = winding;
    this.m.skin.emissive.setRGB(winding ? 0.35 + 0.25 * Math.sin(g.time * 30) : 0, 0, 0);

    // motion
    const fwd = this.forward();
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.addScaledVector(fwd, moveSpeed * dt);
    // titans can't scale cliffs: turn back at steep ground
    if (g.world.groundY(this.pos.x, this.pos.z) - g.world.groundY(ox, oz) > 2.5) {
      this.pos.x = ox; this.pos.z = oz;
      this.wander = this.pickWander();
      this.yaw += 0.6;
    }
    // on maps with buildings in the way, titans wreck what they walk through
    if (g.world.def.crush && moveSpeed > 0.3) {
      this.crushT = (this.crushT || 0) - dt;
      if (this.crushT <= 0) {
        this.crushT = 0.3;
        const c = this.pos.clone().addScaledVector(fwd, this.radius + 0.8);
        g.crush(c.setY(this.pos.y + this.height * 0.3), Math.min(5, this.height * 0.2));
        if (this.height > 9) g.crush(c.setY(this.pos.y + this.height * 0.65), Math.min(5, this.height * 0.2));
      }
    }
    if (this.jumpV || this.jumpY > 0) {
      this.jumpY += this.jumpV * dt; this.jumpV -= 24 * dt;
      this.pos.addScaledVector(fwd, 10 * dt);
      if (this.jumpY <= 0) { this.jumpY = 0; this.jumpV = 0; audio.play('step', this.vol()); g.shake(0.4 * this.vol()); }
    }
    for (const o of g.titans) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = this.radius + o.radius + 1;
      if (d < min && d > 0.01) { this.pos.x += (dx / d) * (min - d) * 0.5; this.pos.z += (dz / d) * (min - d) * 0.5; }
    }
    const throughGate = g.world.def.breached && Math.abs(this.pos.x - (GATE_X0 + GATE_X1) / 2 - 0.5) < 6;
    if (!this.ally && !throughGate && this.pos.z > WALLZ - 1) {
      const wallStop = WALLZ + 3 + this.height * 0.1;
      if (this.pos.z < wallStop) {
        this.pos.z = wallStop;
        if (g.mission && g.mission.titanGoal === 'gate' && Math.abs(this.pos.x - (GATE_X0 + GATE_X1) / 2) < 12) g.onTitanAtGate(this, dt);
      }
    }
    this.pos.x = Math.max(4, Math.min(W - 4, this.pos.x));
    this.pos.z = Math.max(4, Math.min(D - 4, this.pos.z));
    this.pos.y = g.world.groundY(this.pos.x, this.pos.z);

    // animation
    const a = this.anim;
    a.run = moveSpeed / Math.max(1, this.speed) * (this.abnormal ? 1.4 : 1);
    a.phase += dt * moveSpeed / (this.height * 0.12 + 0.6);
    a.lean = this.abnormal ? 0.35 : 0;
    a.kneel = this.down; a.blind = this.blindT; a.limpL = this.limp.L > 0; a.limpR = this.limp.R > 0;
    const sink = this.down ? -10 * this.m.px : 0;
    this.m.root.position.set(this.pos.x, this.pos.y + this.jumpY + sink, this.pos.z);
    this.m.root.rotation.y = this.yaw;
    animateTitan(this.m, a);
    // severed arms leave a stump until they regrow
    this.m.armL.scale.y = this.limp.L > 0 ? 0.35 : 1;
    this.m.armR.scale.y = this.limp.R > 0 ? 0.35 : 1;
    if (this.stagger > 0) this.m.body.rotation.x -= 0.2 * Math.sin(this.stagger * 8);
    this.m.root.updateMatrixWorld(true);
    if (this.warn.visible) this.warn.position.copy(this.pos).setY(this.pos.y + this.height * 1.15 + 1.5);

    const stepIdx = Math.floor(a.phase / Math.PI);
    if (stepIdx !== this.lastStep && moveSpeed > 0) {
      this.lastStep = stepIdx;
      const vv = this.vol();
      if (vv > 0.05) { audio.play('step', vv * Math.min(1, this.height / 12)); g.shake(0.12 * vv * this.height / 15); }
    }
  }

  steamInjuries() {
    const g = this.game, s = this.height * 0.08;
    const at = (o, y) => { const p = o.localToWorld(new THREE.Vector3(0, y, 0)); g.particles.steam(p.x, p.y, p.z, s, 1); };
    if (this.blindT > 0) { const e = this.eyesWorld(); g.particles.steam(e.x, e.y, e.z, s, 1); }
    if (this.limp.L > 0) at(this.m.armL, 0);
    if (this.limp.R > 0) at(this.m.armR, 0);
    if (this.legCut.L > 0) at(this.m.legL, -10 * this.m.px);
    if (this.legCut.R > 0) at(this.m.legR, -10 * this.m.px);
  }

  vol() {
    const d = this.game.camera.position.distanceTo(this.pos);
    return Math.max(0, 1 - d / 70);
  }

  // part: 'eyes' | 'armL' | 'armR' | 'legL' | 'legR'. Returns a label for the feed.
  cutPart(part, point) {
    this.stagger = 0.6;
    this.game.particles.blood(point.x, point.y, point.z, 22, 8);
    audio.play('grunt', Math.max(0.25, this.vol()));
    if (part === 'eyes') { this.blindT = REGEN.eyes; this.state = 'walk'; this.anim.attack = 0; return 'OŚLEPIONY'; }
    if (part === 'armL' || part === 'armR') {
      const k = part === 'armL' ? 'L' : 'R';
      if (this.limp[k] <= 0) this.game.spawnChunk(this, k === 'L' ? this.m.armL : this.m.armR);
      this.limp[k] = REGEN.arm;
      return this.limp.L > 0 && this.limp.R > 0 ? 'ROZBROJONY' : 'RĘKA ODCIĘTA';
    }
    const k = part === 'legL' ? 'L' : 'R';
    this.legCut[k] = REGEN.leg;
    return this.legCut.L > 0 && this.legCut.R > 0 ? 'POWALONY' : 'PODCIĘTY';
  }

  handWorld(out = new THREE.Vector3()) {
    const arm = this.attackArm === 'L' ? this.m.armL : this.m.armR;
    return arm.localToWorld(out.set(0, -13 * this.m.px, 0));
  }

  cutFx(part, point) {
    this.game.particles.blood(point.x, point.y, point.z, 22, 8);
    if (part === 'armL' || part === 'armR') this.game.spawnChunk(this, part === 'armL' ? this.m.armL : this.m.armR);
  }

  kill() {
    this.warn.visible = false;
    this.m.skin.emissive.setRGB(0, 0, 0);
    this.dead = true; this.deadT = 0;
    this.state = 'dead';
    audio.play('groan', Math.max(0.3, this.vol()));
    this.m.hardShell.visible = false;
  }

  updateDead(dt) {
    this.deadT += dt;
    const k = Math.min(1, this.deadT / 1.6);
    this.m.root.rotation.x = (Math.PI / 2) * k * k;
    if (this.deadT > 1.55 && !this.landed) { this.landed = true; audio.play('thud', this.vol()); this.game.shake(0.6 * this.vol()); }
    const g = this.game;
    if (this.deadT < 1.2 && Math.random() < 0.8) {
      const n = this.napeWorld(new THREE.Vector3());
      g.particles.blood(n.x, n.y, n.z, 4, 6);
    }
    if (Math.random() < 0.7) {
      const c = this.napeWorld(new THREE.Vector3());
      const body = this.m.root.position;
      g.particles.steam(c.x * 0.5 + body.x * 0.5, body.y + this.height * 0.15, c.z * 0.5 + body.z * 0.5, this.height * 0.45, 1);
    }
    if (this.deadT > 4) {
      this.m.root.position.y -= dt * this.height * 0.08;
      if (!this.faded) {
        this.faded = true;
        this.m.root.traverse((o) => {
          if (!o.isMesh) return;
          o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
          for (const m of [].concat(o.material)) m.transparent = true;
        });
      }
      const op = Math.max(0, 1 - (this.deadT - 4) / 3);
      this.m.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.opacity = op; });
    }
    this.m.root.updateMatrixWorld(true);
    if (this.deadT > 7) this.remove = true;
  }

  dispose() { this.game.scene.remove(this.m.root, this.warn); }
}
