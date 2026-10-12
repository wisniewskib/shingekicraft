// Titan mode: the player is one of the nine shifters (or a random titan);
// Survey Corps scouts fly at your nape.
import * as THREE from 'three';
import { buildTitan, animateTitan, buildSoldier, animateSoldier } from './models.js';
import { B, W, D, BLOCK_COLORS } from './world.js';
import { audio } from './audio.js';
import { angleDiff, rand, clamp } from './util.js';
import { TITAN_TYPES } from './titantypes.js';

const SOFT_SKIP = new Set([B.BRICK, B.GATE, B.DARK, B.STONE, B.CRATE]);
const WALL_IDS = new Set([B.BRICK, B.GATE, B.DARK]);
const UP = new THREE.Vector3(0, 1, 0);

const rockGeo = new THREE.BoxGeometry(1, 1, 1);
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8580 });
const bulletMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
const crystalMat = new THREE.MeshLambertMaterial({ color: 0x9fe8ff, emissive: 0x2a7fa0, transparent: true, opacity: 0.9 });
const boneMat = new THREE.MeshLambertMaterial({ color: 0xf2ead8, transparent: true, opacity: 0.95 });
const spikeGeo = new THREE.ConeGeometry(1, 1, 5);
const ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 40);

export class PlayerTitan {
  constructor(game) {
    this.game = game;
    this.m = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.anim = { phase: 0, run: 0, attack: 0, attackArm: 'R', attackAngle: 1.6, lean: 0 };
    this.fx = [];
    this.projectiles = [];
  }

  setType(type) {
    if (this.m) this.game.scene.remove(this.m.root);
    this.type = type;
    this.hammerMesh = null; this.bowMesh = null;
    let h = type.h, look = type.look || {};
    if (type.random) h = Math.round(rand(7, 15));
    this.height = h;
    const seed = type.random ? (Math.random() * 1e6) | 0 : 4242 + TITAN_TYPES.indexOf(type) * 97;
    this.m = buildTitan(h, seed, look);
    this.m.root.rotation.order = 'YXZ';
    this.game.scene.add(this.m.root);
    this.walk = type.random ? 3 + h * 0.25 : type.speed;
    this.runSpeed = type.random ? this.walk * 1.7 : type.run;
    this.armor = type.armor || 0;
    this.radius = Math.max(0.7, h * 0.15);
    this.small = h < 8;
  }

  reset() {
    this.nape = 100; this.dead = false;
    this.cd = { lmb: 0, rmb: 0, Q: 0, E: 0, F: 0 };
    this.swipeT = -1; this.grabT = -1; this.kickT = -1; this.hammerT = -1; this.throwT = -1;
    this.chargeT = 0; this.chargeDef = null; this.dashT = 0;
    this.hardenT = 0; this.rageT = 0; this.steamT = 0; this.steamDef = null; this.cannonT = 0; this.cannonFire = 0; this.steamTick = 0;
    this.vy = 0; this.air = false; this.leaping = false; this.vel.set(0, 0, 0);
    this.weapon = null; this.weaponT = 0; this.thin = 0; this.climbing = false;
    if (this.hammerMesh) this.hammerMesh.visible = false;
    if (this.bowMesh) this.bowMesh.visible = false;
    if (this.m) this.m.root.scale.set(1, 1, 1);
    this.crushT = 0; this.lastHurt = -99; this.yaw = Math.PI;
    for (const f of this.fx) this.game.scene.remove(f.mesh);
    for (const p of this.projectiles) this.game.scene.remove(p.mesh);
    this.fx = []; this.projectiles = [];
    if (this.m) { this.m.hardShell.visible = false; this.m.root.rotation.x = 0; }
  }

  spawn(x, z, yaw) { this.reset(); this.pos.set(x, this.game.world.groundY(x, z), z); this.yaw = yaw; }

  get hardened() { return this.hardenT > 0 || this.steamT > 0; }
  get raging() { return this.rageT > 0; }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  napeWorld(out = new THREE.Vector3()) { return this.m.neck.localToWorld(out.set(0, -0.5 * this.m.px, -2.6 * this.m.px)); }
  handWorld(out = new THREE.Vector3(), arm = this.anim.attackArm) {
    const a = arm === 'L' ? this.m.armL : this.m.armR;
    return a.localToWorld(out.set(0, -(a.userData.len || 12) * this.m.px, 0));
  }
  aimFlat() { const d = this.game.camDir; return new THREE.Vector3(d.x, 0, d.z).normalize(); }

  blocked(x, z) {
    const w = this.game.world, g = w.groundY(x, z);
    const r = this.radius + 0.6, top = Math.min(12, Math.max(2, this.height * 0.75));
    for (let a = 0; a < 8; a++) {
      const sx = x + Math.cos(a * Math.PI / 4) * r, sz = z + Math.sin(a * Math.PI / 4) * r;
      for (let y = g + 1; y < g + top; y += 2) if (WALL_IDS.has(w.get(Math.floor(sx), y, Math.floor(sz)))) return true;
    }
    return false;
  }

  smash(c, r, opts) {
    const g = this.game, out = [];
    const n = g.world.destroySphere(c.x, c.y, c.z, r, out, opts);
    if (n) { g.particles.debris(out, BLOCK_COLORS); if (n > 4) audio.play('crumble', 0.6); g.world.dirtyFlag = true; }
    return n;
  }

  hurt(amount) {
    if (this.dead) return;
    this.nape -= amount * (1 - this.armor); this.lastHurt = this.game.time;
    this.game.onPlayerHurt(amount);
    if (this.nape <= 0) { this.nape = 0; this.dead = true; this.game.onPlayerDeath(); }
  }

  liveScouts() { return this.game.scouts.filter((s) => !s.dead); }

  update(dt, input) {
    const g = this.game;
    this.updateFx(dt);
    this.updateProjectiles(dt);
    if (this.dead) {
      this.anim.attack = 0;
      this.m.root.rotation.x = Math.min(Math.PI / 2, this.m.root.rotation.x + dt * 1.2);
      this.m.root.updateMatrixWorld(true);
      if (Math.random() < 0.6) { const n = this.napeWorld(); g.particles.steam(n.x, n.y, n.z, this.height * 0.4, 1); }
      return;
    }
    const cdRate = this.raging ? 1.8 : 1;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt * cdRate);
    this.hardenT = Math.max(0, this.hardenT - dt);
    this.rageT = Math.max(0, this.rageT - dt);
    this.m.hardShell.visible = this.hardenT > 0;
    if (g.time - this.lastHurt > 5) this.nape = Math.min(100, this.nape + 2.5 * dt);
    if (this.weapon) {
      this.weaponT -= dt;
      if (this.weaponT <= 0) { this.weapon = null; g.hud.toast('BROŃ SIĘ ROZSYPAŁA'); }
    }
    if (this.hammerMesh) this.hammerMesh.visible = this.weapon === 'hammer';
    if (this.bowMesh) this.bowMesh.visible = this.weapon === 'crossbow';
    // steam burns the colossus away: it gets thinner while steaming and fills out again slowly
    this.thin = this.steamT > 0 ? Math.min(1, this.thin + dt * 0.14) : Math.max(0, this.thin - dt * 0.04);
    if (this.thin > 0 || this.m.root.scale.x !== 1) this.m.root.scale.set(1 - 0.38 * this.thin, 1, 1 - 0.38 * this.thin);

    const yaw = g.camYaw;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = f.clone().multiplyScalar(input.moveY()).add(r.multiplyScalar(input.moveX()));
    if (wish.lengthSq() > 1) wish.normalize();
    const running = input.held('ShiftLeft') || input.held('ShiftRight');
    let speed = (running ? this.runSpeed : this.walk) * wish.length();
    if (this.raging) speed *= 1.35;
    if (this.steamT > 0) speed *= 0.5;

    // ---- inputs ----
    const claws = !!this.type.claws;
    const swipeDur = claws ? 0.22 : this.small ? 0.35 : 0.6;
    if (input.pressed('Mouse0') && this.cd.lmb <= 0) {
      if (this.weapon === 'hammer') {
        if (this.hammerT < 0) { this.hammerT = 0; this.cd.lmb = 0.95; this.yaw = Math.atan2(f.x, f.z); audio.play('harden', 0.5); }
      } else if (this.weapon === 'crossbow') {
        this.fireBolt(); this.cd.lmb = 0.28; this.yaw = Math.atan2(f.x, f.z);
      } else if (this.swipeT < 0) {
        this.swipeT = 0; this.cd.lmb = claws ? 0.24 : this.small ? 0.45 : 0.8;
        this.anim.attackArm = this.anim.attackArm === 'L' ? 'R' : 'L';
        this.anim.attackAngle = claws ? 1.3 : 1.7;
        this.yaw = Math.atan2(f.x, f.z);
        audio.play('slash', claws ? 0.8 : 0.6);
      }
    }
    if (input.pressed('Mouse2') && this.cd.rmb <= 0) { this.cd.rmb = 2; this.grabT = 0; this.anim.attackArm = 'R'; this.anim.attackAngle = 1.5; this.grab(); }
    if (input.pressed('Space') && !this.air) { this.vy = Math.min(22, 8 + this.height * 0.35); this.air = true; }
    for (const k of ['Q', 'E', 'F']) if (input.pressed('Key' + k)) this.useAbility(k);

    // ---- active effects ----
    let move = wish.clone();
    if (this.chargeT > 0) {
      this.chargeT -= dt;
      move = this.forward(); speed = Math.max(18, this.runSpeed * 1.8);
      this.crushT -= dt;
      if (this.crushT <= 0) {
        this.crushT = 0.08;
        const c = this.pos.clone().addScaledVector(this.forward(), 3);
        const pw = !(this.chargeDef && this.chargeDef.breakWall);
        this.smash(c.clone().setY(this.pos.y + this.height * 0.55), 4.2, { protectWall: pw });
        this.smash(c.clone().setY(this.pos.y + this.height * 0.25), 3.6, { protectWall: pw });
        g.shake(0.35);
        g.killScoutsNear(c.clone().setY(this.pos.y + this.height * 0.5), 6 + this.height * 0.2, 'STARANOWANY');
      }
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      move = this.forward(); speed = this.runSpeed * 2.2;
      g.killScoutsNear(this.pos.clone().setY(this.pos.y + this.height * 0.5), 3 + this.height * 0.4, 'ROZJECHANY');
      if (Math.random() < 0.5) g.particles.puff(this.pos.x, this.pos.y + 0.5, this.pos.z, 0, 1, 0, 1.5, 0.6, 0xb8b0a0, 0.4, 2);
    } else if (wish.lengthSq() > 0.01 && this.swipeT < 0 && this.hammerT < 0) {
      this.yaw += angleDiff(this.yaw, Math.atan2(wish.x, wish.z)) * Math.min(1, 6 * dt);
    }
    if (this.hammerT >= 0 || this.kickT >= 0 || this.throwT >= 0) speed *= 0.2;

    // ---- movement ----
    if (this.type.climb) { this.moveClimber(dt, move, speed, input); } else {
    const hx = this.air && this.leaping ? this.vel.x : move.x * speed;
    const hz = this.air && this.leaping ? this.vel.z : move.z * speed;
    const nx = clamp(this.pos.x + hx * dt, 4, W - 4), nz = clamp(this.pos.z + hz * dt, 4, D - 4);
    if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
    const ground = g.world.groundY(this.pos.x, this.pos.z);
    if (this.air) {
      this.vy -= 30 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground; this.air = false; this.vy = 0;
        audio.play('step', 1); g.shake(0.3 + this.height * 0.02);
        if (this.leaping) { this.leaping = false; this.stomp(Math.max(7, this.height * 1.3), true); }
      }
    } else this.pos.y = ground;
    }

    // crush houses / trees by walking through them (big titans only)
    this.crushT -= dt;
    if (!this.small && speed > 0.5 && this.crushT <= 0 && this.chargeT <= 0) {
      this.crushT = 0.15;
      const c = this.pos.clone().addScaledVector(this.forward(), this.radius + 1);
      const rr = Math.min(6, this.height * 0.17);
      this.smash(c.setY(this.pos.y + 3), rr, { skip: SOFT_SKIP });
      this.smash(c.setY(this.pos.y + this.height * 0.5), rr + 0.2, { skip: SOFT_SKIP });
    }

    // ---- timed attacks ----
    if (this.swipeT >= 0) {
      this.swipeT += dt;
      this.anim.attack = Math.min(1, this.swipeT / swipeDur);
      if (this.swipeT >= swipeDur * 0.45 && this.swipeT - dt < swipeDur * 0.45) this.primaryHit();
      if (this.swipeT >= swipeDur) { this.swipeT = -1; this.anim.attack = 0; }
    } else if (this.grabT >= 0) {
      this.grabT += dt;
      this.anim.attack = Math.min(1, this.grabT / 0.6);
      if (this.grabT >= 0.6) { this.grabT = -1; this.anim.attack = 0; }
    } else if (this.throwT >= 0) {
      this.throwT += dt;
      this.anim.attackArm = 'R'; this.anim.attackAngle = 2.8;
      this.anim.attack = Math.min(1, this.throwT / 0.6);
      if (this.throwT >= 0.3 && this.throwT - dt < 0.3) this.releaseRocks();
      if (this.throwT >= 0.6) { this.throwT = -1; this.anim.attack = 0; }
    }
    if (this.kickT >= 0) {
      this.kickT += dt;
      if (this.kickT >= 0.22 && this.kickT - dt < 0.22) this.kick(this.kickDef);
      if (this.kickT >= 0.5) this.kickT = -1;
    }
    if (this.hammerT >= 0) {
      this.hammerT += dt;
      this.anim.attackArm = 'R'; this.anim.attackAngle = 2.9;
      this.anim.attack = this.hammerT < 0.45 ? 0.5 * (this.hammerT / 0.45) : Math.min(1, 0.5 + (this.hammerT - 0.45) / 0.3 * 0.5);
      if (this.hammerT >= 0.5 && this.hammerT - dt < 0.5) this.hammerSlam();
      if (this.hammerT >= 0.85) { this.hammerT = -1; this.anim.attack = 0; }
    }
    if (this.steamT > 0) {
      this.steamT -= dt; this.steamTick -= dt;
      if (this.steamDef.burn) { this.nape = Math.max(8, this.nape - this.steamDef.burn * dt); this.lastHurt = g.time; }
      const c = this.pos.clone().setY(this.pos.y + this.height * 0.5);
      for (let i = 0; i < 3; i++) g.particles.steam(c.x + rand(-1, 1) * this.height * 0.3, this.pos.y + rand(0.1, 1) * this.height, c.z + rand(-1, 1) * this.height * 0.3, this.height * 0.4, 1);
      if (this.steamTick <= 0) {
        this.steamTick = 0.25;
        for (const s of this.liveScouts()) if (s.pos.distanceTo(c) < this.steamDef.r) g.killScout(s, 'UGOTOWANY PARĄ');
      }
    }
    if (this.cannonT > 0) {
      this.cannonT -= dt; this.cannonFire -= dt;
      if (this.cannonFire <= 0) { this.cannonFire = 0.07; this.fireBullet(); }
    }

    // ---- animation ----
    const a = this.anim;
    a.run = this.chargeT > 0 || this.dashT > 0 ? 1.6 : speed / Math.max(1, this.walk);
    a.phase += dt * Math.max(speed, this.chargeT > 0 ? 14 : 0) / Math.max(0.8, this.height * 0.16);
    a.lean = this.chargeT > 0 || this.dashT > 0 ? 0.45 : 0;
    this.m.root.position.copy(this.pos);
    this.m.root.rotation.y = this.yaw;
    animateTitan(this.m, a);
    if (this.chargeT > 0) { this.m.armL.rotation.x = -0.3; this.m.armR.rotation.x = -0.3; this.m.armR.rotation.z = -0.6; }
    if (this.kickT >= 0) { const k = Math.sin(Math.min(1, this.kickT / 0.5) * Math.PI); this.m.legR.rotation.x = -1.7 * k; this.m.body.rotation.x -= 0.3 * k; }
    if (this.air && !this.climbing) { this.m.legL.rotation.x = -0.6; this.m.legR.rotation.x = 0.3; }
    if (this.climbing) {
      const k = Math.sin(g.time * 10);
      this.m.armL.rotation.set(-2.6 + k * 0.4, 0, 0.2); this.m.armR.rotation.set(-2.6 - k * 0.4, 0, -0.2);
      this.m.legL.rotation.x = -0.8 - k * 0.3; this.m.legR.rotation.x = -0.8 + k * 0.3;
    }
    if (this.weapon === 'crossbow' && this.swipeT < 0) this.m.armR.rotation.set(-Math.PI / 2 - g.camPitch, 0, -0.1);
    if (this.type.claws && this.swipeT >= 0) {
      const k = Math.min(1, this.swipeT / swipeDur), e = 1 - (1 - k) * (1 - k);
      const side = this.anim.attackArm === 'L' ? 1 : -1;
      const arm = side > 0 ? this.m.armL : this.m.armR;
      arm.rotation.set(-1.45, 0, side * (1.5 - 3.0 * e));
      this.m.body.rotation.y = side * (0.55 - 1.1 * e);
    }
    this.m.root.updateMatrixWorld(true);

    const stepIdx = Math.floor(a.phase / Math.PI);
    if (stepIdx !== this.lastStep && speed > 0.5 && !this.air) {
      this.lastStep = stepIdx;
      const v = clamp(this.height / 15, 0.25, 1.4);
      audio.play('step', Math.min(1, 0.4 * v + 0.3)); g.shake(0.12 * v);
    }
  }

  // ---------- attacks ----------
  primaryHit() {
    const g = this.game;
    const aim = this.aimFlat();
    const claws = !!this.type.claws;
    const R = (claws ? this.height * 0.9 + 6.5 : this.height * 0.75 + 6) * (this.raging ? 1.4 : 1);
    const arc = claws ? -0.45 : 0.2; // claws sweep around to both sides
    for (const s of this.liveScouts()) {
      const d = s.pos.clone().sub(this.pos);
      const hd = Math.hypot(d.x, d.z);
      if (hd > R || d.y < -3 || d.y > this.height * 1.3 + 4) continue;
      if ((d.x * aim.x + d.z * aim.z) / (hd || 1) > arc || hd < this.radius + 2) g.damageScout(s, claws ? 1 : 2, claws ? 'ROZORANY' : 'ZBITY');
    }
    if (claws) this.clawFx(aim);
    this.napeSwat();
    if (!this.small || this.raging) {
      const hand = this.handWorld();
      const sh = this.pos.clone().setY(this.pos.y + this.height * 0.7);
      for (let k = 0.3; k <= 1.01; k += 0.35) {
        const p = sh.clone().lerp(hand, k).addScaledVector(this.forward(), 2.5);
        this.smash(p, Math.min(6, 2 + this.height * 0.15), { protectWall: true });
      }
    }
    g.shake(0.3);
    audio.play('step', 0.8);
  }

  // Every attack also clears scouts hanging on your neck.
  napeSwat() {
    const n = this.napeWorld();
    for (const s of this.liveScouts()) if (s.pos.distanceTo(n) < this.height * 0.4 + 5) this.game.killScout(s, 'STRĄCONY Z KARKU');
  }

  grab() {
    const g = this.game;
    const chest = this.pos.clone().setY(this.pos.y + this.height * 0.6);
    let best = null, bd = this.height * 0.9 + 7;
    for (const s of this.liveScouts()) {
      const d = s.pos.distanceTo(chest);
      if (d < bd) { best = s; bd = d; }
    }
    if (best) {
      const dy = best.pos.y - (this.pos.y + this.height * 0.72);
      this.anim.attackAngle = clamp(Math.atan2(Math.hypot(best.pos.x - this.pos.x, best.pos.z - this.pos.z), -dy), 0.5, 3);
      this.yaw = Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z);
      g.killScout(best, 'ZŁAPANY');
    } else g.hud.toast('PUDŁO');
  }

  useAbility(key) {
    const a = this.type.abilities[key];
    if (!a || this.cd[key] > 0) return;
    const g = this.game;
    switch (a.type) {
      case 'charge': this.chargeT = a.dur || 1.1; this.chargeDef = a; this.yaw = Math.atan2(this.aimFlat().x, this.aimFlat().z); audio.play('roar', 0.8); break;
      case 'harden': this.hardenT = a.dur; audio.play('harden'); g.hud.toast(a.name.toUpperCase()); break;
      case 'rage': this.rageT = a.dur; audio.play('roar'); g.hud.toast(a.name.toUpperCase()); this.ring(0xff5a3a, 14, 0.6); break;
      case 'stomp': this.stomp(a.r, true); break;
      case 'kick': this.kickT = 0; this.kickDef = a; this.yaw = Math.atan2(this.aimFlat().x, this.aimFlat().z); break;
      case 'scream': this.scream(a); break;
      case 'steam': this.steamT = a.dur; this.steamDef = a; audio.play('roar'); g.hud.toast('WYBUCH PARY'); break;
      case 'throw': if (this.throwT >= 0) return; this.throwT = 0; this.throwN = a.n; this.yaw = Math.atan2(this.aimFlat().x, this.aimFlat().z); break;
      case 'summon': this.summon(a.n); break;
      case 'dash': this.dashT = 0.45; this.yaw = Math.atan2(this.aimFlat().x, this.aimFlat().z); audio.play('hook'); break;
      case 'cannon': this.cannonT = a.dur; g.hud.toast('DZIAŁKA'); break;
      case 'leap':
        if (this.air) return;
        this.vy = 12 + this.height * 0.5; this.air = true; this.leaping = true;
        this.vel.copy(this.aimFlat()).multiplyScalar(16 + this.height * 0.5);
        this.yaw = Math.atan2(this.vel.x, this.vel.z);
        audio.play('roar', 0.5);
        break;
      case 'hammer':
        if (!this.hammerMesh) {
          const px = this.m.px;
          this.hammerMesh = new THREE.Mesh(new THREE.BoxGeometry(6 * px, 6 * px, 11 * px), crystalMat);
          this.m.armR.add(this.hammerMesh);
          this.hammerMesh.position.set(0, -(this.m.armR.userData.len + 3) * this.m.px, 0);
        }
        this.hammerT = 0; this.yaw = Math.atan2(this.aimFlat().x, this.aimFlat().z);
        audio.play('harden');
        break;
      case 'spikes': this.spikes(a.r); break;
      case 'weapon':
        this.ensureWeapons();
        this.weapon = a.weapon; this.weaponT = a.dur;
        audio.play('harden'); g.hud.toast(a.name.toUpperCase());
        for (let i = 0; i < 12; i++) { const h = this.handWorld(new THREE.Vector3(), 'R'); g.particles.puff(h.x, h.y, h.z, rand(-3, 3), rand(0, 3), rand(-3, 3), 1.5, 0.7, 0x9fe8ff, 0.7, 1.5); }
        break;
    }
    this.cd[key] = a.cd;
  }

  stomp(r, smashBlocks) {
    const g = this.game;
    for (const s of this.liveScouts()) {
      const hd = Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z);
      if (hd < r && s.pos.y < this.pos.y + this.height * 0.5 + 10) g.killScout(s, 'ZDEPTANY');
      else if (hd < r * 1.8) s.stun(2.5, false);
    }
    if (smashBlocks) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.smash(new THREE.Vector3(this.pos.x + Math.cos(a) * r * 0.4, this.pos.y + 1.5, this.pos.z + Math.sin(a) * r * 0.4), Math.min(5, r * 0.25), { protectWall: true });
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      g.particles.puff(this.pos.x + Math.cos(a) * r * 0.5, this.pos.y + 0.5, this.pos.z + Math.sin(a) * r * 0.5, Math.cos(a) * r * 0.8, 1, Math.sin(a) * r * 0.8, 3, 1.2, 0xb8b0a0, 0.5, 2);
    }
    this.ring(0xd8c8a0, r, 0.5);
    audio.play('crumble'); audio.play('step', 1);
    g.shake(1);
  }

  kick(a) {
    const g = this.game;
    const fw = this.forward();
    const c = this.pos.clone().addScaledVector(fw, this.height * 0.5).setY(this.pos.y + this.height * 0.35);
    const rr = Math.max(5, this.height * 0.3) * (a.r || 1.5);
    for (const s of this.liveScouts()) if (s.pos.distanceTo(c) < rr * 1.3) g.killScout(s, 'KOPNIĘTY');
    this.napeSwat();
    const sr = Math.min(9, rr * 0.7);
    this.smash(c, sr, { protectWall: !a.breakWall });
    this.smash(c.clone().addScaledVector(fw, sr * 0.8), sr, { protectWall: !a.breakWall });
    audio.play('crumble'); g.shake(0.8);
  }

  scream(a) {
    const g = this.game;
    let n = 0;
    for (const s of this.liveScouts()) if (s.pos.distanceTo(this.pos) < a.r) { s.stun(a.freeze ? 5 : 4, !!a.freeze); n++; }
    this.ring(a.freeze ? 0xbfe8ff : 0xffffff, a.r, 1.0);
    this.ring(a.freeze ? 0xbfe8ff : 0xffffff, a.r * 0.6, 0.8);
    audio.play('roar', 1); audio.play('roar', 1);
    g.shake(0.6);
    g.hud.toast(`${a.name.toUpperCase()} · OGŁUSZONYCH: ${n}`);
  }

  summon(n) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      g.spawnAlly(this.pos.x + Math.cos(a) * 14, this.pos.z + Math.sin(a) * 14);
    }
    audio.play('roar'); g.hud.toast(`PRZYBYWA TYTANÓW: ${n}`);
  }

  spikes(r) {
    const g = this.game;
    const bone = this.type.id === 'founding';
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(this.radius + 3, r);
      const x = this.pos.x + Math.cos(a) * d, z = this.pos.z + Math.sin(a) * d;
      const y = g.world.groundY(x, z);
      const hgt = rand(7, 16), rad = rand(0.7, 1.6);
      const mesh = new THREE.Mesh(spikeGeo, bone ? boneMat : crystalMat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rand(-0.25, 0.25), 0, rand(-0.25, 0.25));
      g.scene.add(mesh);
      this.fx.push({ mesh, t: 0, life: 3.2, update: (f) => {
        const k = f.t < 0.25 ? f.t / 0.25 : f.t > 2.7 ? Math.max(0, 1 - (f.t - 2.7) / 0.5) : 1;
        f.mesh.scale.set(rad, hgt * k, rad);
        f.mesh.position.y = y + (hgt * k) / 2 - 0.5;
      } });
    }
    for (const s of this.liveScouts()) {
      const hd = Math.hypot(s.pos.x - this.pos.x, s.pos.z - this.pos.z);
      if (hd < r && s.pos.y < this.pos.y + 18) g.killScout(s, 'PRZEBITY');
    }
    audio.play('harden'); audio.play('crumble'); g.shake(0.7);
  }

  hammerSlam() {
    const g = this.game;
    const fw = this.forward();
    for (let d = 3; d <= this.height + 9; d += 3) {
      const p = this.pos.clone().addScaledVector(fw, d);
      p.y = g.world.groundY(p.x, p.z) + 2;
      this.smash(p, 3.5, { protectWall: true });
      for (const s of this.liveScouts()) if (Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 5 && s.pos.y < this.pos.y + this.height) g.killScout(s, 'ZMIAŻDŻONY');
      g.particles.puff(p.x, p.y, p.z, 0, 3, 0, 3, 1, 0x9fe8ff, 0.5, 2);
    }
    this.napeSwat();
    audio.play('crumble'); audio.play('clang'); g.shake(1);
  }

  ensureWeapons() {
    const px = this.m.px;
    if (!this.hammerMesh) {
      this.hammerMesh = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.BoxGeometry(1.2 * px, 1.2 * px, 14 * px), crystalMat);
      handle.position.z = 6 * px;
      const head = new THREE.Mesh(new THREE.BoxGeometry(7 * px, 6 * px, 6 * px), crystalMat);
      head.position.z = 13 * px;
      this.hammerMesh.add(handle, head);
      this.hammerMesh.position.set(0, -(this.m.armR.userData.len + 1) * px, 0);
      this.m.armR.add(this.hammerMesh);
    }
    if (!this.bowMesh) {
      this.bowMesh = new THREE.Group();
      const stock = new THREE.Mesh(new THREE.BoxGeometry(1.6 * px, 1.6 * px, 9 * px), crystalMat);
      stock.position.z = 3 * px;
      const limbs = new THREE.Mesh(new THREE.BoxGeometry(12 * px, 1 * px, 1.2 * px), crystalMat);
      limbs.position.z = 7 * px;
      this.bowMesh.add(stock, limbs);
      this.bowMesh.position.set(0, -(this.m.armR.userData.len - 1) * px, 0);
      this.m.armR.add(this.bowMesh);
    }
  }

  // Crossbow: fast crystal bolts that pierce through several scouts.
  fireBolt() {
    const g = this.game;
    const origin = this.handWorld(new THREE.Vector3(), 'R');
    const c = g.camera.position, d = g.camDir;
    const hit = g.world.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 160);
    const target = hit ? new THREE.Vector3(hit.px, hit.py, hit.pz) : c.clone().addScaledVector(d, 160);
    const dir = target.sub(origin).normalize();
    const mesh = new THREE.Mesh(rockGeo, crystalMat);
    mesh.scale.set(0.35, 0.35, 2.4);
    mesh.lookAt(mesh.position.clone().add(dir));
    g.scene.add(mesh);
    this.projectiles.push({ type: 'bolt', mesh, pos: origin.clone(), vel: dir.multiplyScalar(150), grav: 0, life: 1.2, r: 2.6, hit: new Set() });
    audio.play('clang', 0.5); audio.play('hook', 0.5);
  }

  // Three glowing claw streaks that sweep across in front of the titan.
  clawFx(aim) {
    const g = this.game, side = this.anim.attackArm === 'L' ? 1 : -1;
    const yaw = Math.atan2(aim.x, aim.z);
    const c = this.pos.clone().setY(this.pos.y + this.height * 0.55);
    const R = this.height * 0.9 + 2.5;
    for (let i = 0; i < 3; i++) {
      const r = R - 0.8 + i * 0.8;
      const geo = new THREE.RingGeometry(r, r + 0.22, 28, 1, -Math.PI * 0.55, Math.PI * 1.1);
      const mat = new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffffff : 0xfff0b0, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(c).setY(c.y + (i - 1) * 0.35);
      mesh.rotation.order = 'YXZ';
      g.scene.add(mesh);
      // lie almost flat, tilted down towards the swing side, and spin through the sweep
      this.fx.push({ mesh, t: 0, life: 0.22, update: (f) => {
        const k = f.t / f.life;
        f.mesh.rotation.set(-Math.PI / 2 + side * 0.35, yaw + Math.PI / 2 - side * (0.9 - k * 1.8), side * 0.25);
        f.mesh.material.opacity = 0.95 * (1 - k);
        f.mesh.scale.setScalar(0.9 + k * 0.2);
      } });
    }
    for (let i = 0; i < 6; i++) {
      const a = yaw + side * (-1.2 + i * 0.5);
      g.particles.puff(c.x + Math.sin(a) * R, c.y, c.z + Math.cos(a) * R, Math.sin(a) * 4, 0.5, Math.cos(a) * 4, 0.8, 0.25, 0xffffff, 0.7, 0.5);
    }
  }

  // Small climbers move with real block collision: they stand on roofs and walls and scale vertical faces.
  moveClimber(dt, move, speed, input) {
    const g = this.game, w = g.world;
    const r = this.radius + 0.3, top = this.height * 0.85;
    const hits = (x, y, z) => {
      for (let a = 0; a < 8; a++) {
        const sx = x + Math.cos(a * Math.PI / 4) * r, sz = z + Math.sin(a * Math.PI / 4) * r;
        for (let yy = y + 0.6; yy < y + top; yy += 1) if (w.solid(sx, yy, sz)) return true;
      }
      return false;
    };
    const standY = (x, z, y) => {
      let best = 0;
      for (let a = 0; a < 5; a++) {
        const sx = a === 4 ? x : x + Math.cos(a * Math.PI / 2) * r * 0.7, sz = a === 4 ? z : z + Math.sin(a * Math.PI / 2) * r * 0.7;
        for (let yy = Math.floor(y + 0.9); yy >= 0; yy--) if (w.get(Math.floor(sx), yy, Math.floor(sz))) { best = Math.max(best, yy + 1); break; }
      }
      return best;
    };
    const lx = this.air && this.leaping ? this.vel.x : move.x * speed;
    const lz = this.air && this.leaping ? this.vel.z : move.z * speed;
    const nx = clamp(this.pos.x + lx * dt, 4, W - 4), nz = clamp(this.pos.z + lz * dt, 4, D - 4);
    let blocked = false;
    if (!hits(nx, this.pos.y, this.pos.z)) this.pos.x = nx; else blocked = true;
    if (!hits(this.pos.x, this.pos.y, nz)) this.pos.z = nz; else blocked = true;
    // push into a wall while moving = climb it
    this.climbing = blocked && move.lengthSq() > 0.1 && speed > 0.5;
    if (this.climbing) {
      this.vy = 0; this.air = false; this.leaping = false;
      this.pos.y += 9 * dt;
      if (Math.random() < 0.3) g.particles.puff(this.pos.x, this.pos.y + 1, this.pos.z, 0, -1, 0, 1, 0.5, 0xb8b0a0, 0.4, 2);
      return;
    }
    const floor = standY(this.pos.x, this.pos.z, this.pos.y);
    if (this.air || this.pos.y > floor + 0.05) {
      this.air = true;
      this.vy -= 30 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= floor) {
        this.pos.y = floor; this.air = false; this.vy = 0;
        audio.play('step', 0.6);
        if (this.leaping) { this.leaping = false; this.stomp(Math.max(7, this.height * 1.3), true); }
      }
    } else this.pos.y = floor;
  }

  releaseRocks() {
    const g = this.game;
    const hand = this.handWorld(new THREE.Vector3(), 'R');
    const aim = g.camDir.clone();
    // one big boulder...
    const big = new THREE.Mesh(rockGeo, rockMat);
    big.scale.setScalar(3.4);
    big.position.copy(hand);
    g.scene.add(big);
    this.projectiles.push({ type: 'boulder', mesh: big, pos: hand.clone(), vel: aim.clone().multiplyScalar(58).addScaledVector(UP, 5), grav: 16, life: 4, r: 3.4 });
    // ...and a spray of smaller shards that hurt less
    for (let i = 0; i < this.throwN; i++) {
      const dir = aim.clone().add(new THREE.Vector3(rand(-0.08, 0.08), rand(-0.03, 0.07), rand(-0.08, 0.08))).normalize();
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.scale.setScalar(rand(0.9, 1.4));
      mesh.position.copy(hand);
      g.scene.add(mesh);
      this.projectiles.push({ type: 'shard', mesh, pos: hand.clone(), vel: dir.multiplyScalar(rand(50, 66)).addScaledVector(UP, 3), grav: 18, life: 3.5, r: 1.8 });
    }
    audio.play('roar', 0.5);
  }

  fireBullet() {
    const g = this.game;
    const origin = this.pos.clone().setY(this.pos.y + this.height * 0.95).addScaledVector(this.forward(), -0.5);
    const c = g.camera.position, d = g.camDir;
    const hit = g.world.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 140);
    const target = hit ? new THREE.Vector3(hit.px, hit.py, hit.pz) : c.clone().addScaledVector(d, 140);
    const dir = target.sub(origin).normalize().add(new THREE.Vector3(rand(-0.02, 0.02), rand(-0.02, 0.02), rand(-0.02, 0.02))).normalize();
    const mesh = new THREE.Mesh(rockGeo, bulletMat);
    mesh.scale.setScalar(0.3);
    g.scene.add(mesh);
    this.projectiles.push({ type: 'bullet', mesh, pos: origin, vel: dir.multiplyScalar(120), grav: 0, life: 1.3, r: 2.2 });
    audio.play('clang', 0.4);
    g.particles.puff(origin.x, origin.y, origin.z, 0, 1, 0, 1, 0.3, 0xffd080, 0.7, 1);
  }

  updateProjectiles(dt) {
    const g = this.game;
    const LABEL = { boulder: 'GŁAZ', shard: 'ODŁAMEK', rock: 'GŁAZ', bullet: 'ZESTRZELONY', bolt: 'PRZESTRZELONY' };
    const DMG = { boulder: 2, shard: 1, rock: 2, bullet: 2, bolt: 2 };
    for (const p of this.projectiles) {
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.type === 'bolt') p.mesh.lookAt(p.pos.clone().add(p.vel));
      else { p.mesh.rotation.x += dt * 5; p.mesh.rotation.y += dt * 3; }
      for (const s of this.liveScouts()) {
        if (s.pos.distanceTo(p.pos) >= p.r) continue;
        if (p.type === 'bolt') { if (!p.hit.has(s)) { p.hit.add(s); g.damageScout(s, DMG.bolt, LABEL.bolt); } continue; } // pierces
        g.damageScout(s, DMG[p.type], LABEL[p.type]);
        if (p.type === 'bullet' || p.type === 'shard') p.life = 0;
      }
      if (p.life > 0 && (g.world.solid(p.pos.x, p.pos.y, p.pos.z) || p.pos.y < g.world.groundY(p.pos.x, p.pos.z))) {
        if (p.type === 'boulder') {
          this.smash(p.pos, 4.5, { protectWall: true });
          for (const s of this.liveScouts()) if (s.pos.distanceTo(p.pos) < 7) g.damageScout(s, 2, LABEL.boulder);
          for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.particles.puff(p.pos.x, p.pos.y, p.pos.z, Math.cos(a) * 8, 2, Math.sin(a) * 8, 4, 1.2, 0xb8b0a0, 0.55, 2); }
          g.shake(0.6); audio.play('crumble', 0.9);
        } else if (p.type === 'rock') { this.smash(p.pos, 2.6, { protectWall: true }); g.shake(0.3); audio.play('crumble', 0.6); }
        else if (p.type === 'shard') this.smash(p.pos, 1.2, { protectWall: true });
        g.particles.puff(p.pos.x, p.pos.y, p.pos.z, 0, 2, 0, p.type === 'boulder' ? 6 : 1, 0.8, p.type === 'bolt' ? 0x9fe8ff : 0xb8b0a0, 0.5, 2);
        p.life = 0;
      }
      if (p.life <= 0) g.scene.remove(p.mesh);
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  ring(color, r, life) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(this.pos).setY(this.pos.y + 1.5);
    this.game.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life, update: (f) => {
      const k = f.t / f.life;
      f.mesh.scale.setScalar(Math.max(0.1, r * k));
      f.mesh.material.opacity = 0.8 * (1 - k);
    } });
  }

  updateFx(dt) {
    for (const f of this.fx) { f.t += dt; f.update(f, dt); if (f.t >= f.life) this.game.scene.remove(f.mesh); }
    this.fx = this.fx.filter((f) => f.t < f.life);
  }

  dispose() { if (this.m) this.game.scene.remove(this.m.root); }
}

// ---------------- Scouts (AI soldiers hunting the player titan) ----------------
const ropeGeo = new THREE.BoxGeometry(1, 1, 1);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
const CAPES = [0x2f6b3a, 0x2f6b3a, 0x3a4f7a, 0x7a2f2f];

export class Scout {
  constructor(game, pos) {
    this.game = game;
    const blond = Math.random() < 0.5;
    this.m = buildSoldier({ cape: CAPES[(Math.random() * CAPES.length) | 0], hair: blond ? 0xb08a4a : 0x3a2616, hairHex: blond ? '#b08a4a' : '#3a2616' });
    this.m.root.scale.setScalar(1.15);
    game.scene.add(this.m.root);
    this.rope = new THREE.Mesh(ropeGeo, ropeMat);
    game.scene.add(this.rope);
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.state = 'orbit';
    this.t = rand(2, 5);
    this.orbitA = Math.random() * Math.PI * 2;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitR = rand(16, 28);
    this.orbitH = rand(0.5, 1.3);
    this.anchor = null;
    this.anim = { phase: 0, run: 0, air: true, slash: 0, boost: 1, speed: 20 };
    this.dead = false; this.deadT = 0; this.stunT = 0; this.frozen = false;
    this.hp = 2; // strong hits (2) kill, light ones (1: shards, claws) stun first
    this.slashT = 0;
  }

  get threatening() { return this.state === 'windup' || this.state === 'dive'; }

  newAnchor() {
    const w = this.game.world;
    const dir = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize().multiplyScalar(0.6).add(new THREE.Vector3(rand(-0.4, 0.4), 0.8, rand(-0.4, 0.4))).normalize();
    const hit = w.raycast(this.pos.x, this.pos.y + 1, this.pos.z, dir.x, dir.y, dir.z, 60);
    this.anchor = hit ? new THREE.Vector3(hit.px, hit.py, hit.pz) : null;
  }

  stun(t, freeze) {
    if (this.dead) return;
    this.state = 'stunned'; this.stunT = t; this.frozen = freeze; this.anchor = null;
    if (freeze) this.vel.set(0, 0, 0);
  }

  update(dt) {
    const g = this.game, T = g.titanPlayer;
    if (this.dead) {
      this.deadT += dt;
      this.vel.y -= 24 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const gy = g.world.groundY(this.pos.x, this.pos.z);
      if (this.pos.y < gy) { this.pos.y = gy; this.vel.set(0, 0, 0); }
      this.m.root.position.copy(this.pos);
      this.m.root.rotation.x = Math.min(Math.PI / 2, this.deadT * 4);
      this.rope.visible = false;
      if (this.deadT > 3) this.remove = true;
      return;
    }
    this.t -= dt;
    let target = null, spd = 20;
    const nape = T.napeWorld();
    if (this.state === 'stunned') {
      this.stunT -= dt;
      if (!this.frozen) {
        this.vel.y -= 24 * dt;
        this.pos.addScaledVector(this.vel, dt);
        const gy = g.world.groundY(this.pos.x, this.pos.z);
        if (this.pos.y < gy) { this.pos.y = gy; this.vel.set(0, 0, 0); }
      }
      if (this.stunT <= 0) { this.state = 'retreat'; this.t = 1.5; this.frozen = false; }
    } else if (this.state === 'orbit') {
      this.orbitA += this.orbitDir * dt * 0.5;
      target = T.pos.clone().add(new THREE.Vector3(Math.cos(this.orbitA) * this.orbitR, T.height * this.orbitH, Math.sin(this.orbitA) * this.orbitR));
      if (this.t <= 0 && !T.dead) { this.state = 'approach'; this.t = 5; audio.play('hook', 0.6); this.newAnchor(); }
    } else if (this.state === 'approach') {
      // get into position behind the nape, then telegraph the dive
      target = nape.clone().addScaledVector(T.forward(), -(6 + T.height * 0.15)).setY(nape.y + 2);
      spd = 26;
      if (this.pos.distanceTo(target) < 2.5 || this.t <= 0) { this.state = 'windup'; this.t = 0.75; }
    } else if (this.state === 'windup') {
      target = this.pos.clone();
      if (Math.random() < 0.5) g.particles.puff(this.pos.x, this.pos.y + 1, this.pos.z, 0, 0, 0, 0.6, 0.3, 0xff4a3a, 0.9, 1);
      if (this.t <= 0) { this.state = 'dive'; this.t = 1.2; audio.play('slash', 0.5); }
    } else if (this.state === 'dive') {
      target = nape; spd = 34;
      if (this.pos.distanceTo(nape) < 2.2) {
        this.slashT = 0.3;
        if (T.hardened) { audio.play('clang'); g.hud.toast('ODBITE'); this.stun(1.5, false); this.vel.set(rand(-8, 8), 10, rand(-8, 8)); }
        else { audio.play('cut', 0.7); g.particles.blood(nape.x, nape.y, nape.z, 20, 6); T.hurt(17); this.state = 'retreat'; this.t = rand(1.5, 2.5); }
        this.vel.add(T.forward().multiplyScalar(-14)).setY(14);
        this.newAnchor();
      } else if (this.t <= 0) { this.state = 'retreat'; this.t = 1.5; }
    } else {
      target = this.pos.clone().add(this.vel.clone().setY(0).normalize().multiplyScalar(10)).setY(T.pos.y + T.height * 1.4);
      if (this.t <= 0) { this.state = 'orbit'; this.t = rand(3, 7); this.orbitA = Math.atan2(this.pos.z - T.pos.z, this.pos.x - T.pos.x); this.newAnchor(); }
    }
    if (target) {
      const want = target.clone().sub(this.pos);
      const dist = want.length();
      if (dist > 0.01) want.multiplyScalar(Math.min(spd, dist * 3) / dist);
      this.vel.lerp(want, 1 - Math.exp(-(this.state === 'dive' ? 8 : 3) * dt));
      this.pos.addScaledVector(this.vel, dt);
      const gy = g.world.groundY(this.pos.x, this.pos.z);
      if (this.pos.y < gy) this.pos.y = gy;
    }
    this.pos.x = clamp(this.pos.x, 2, W - 2); this.pos.z = clamp(this.pos.z, 2, D - 2);

    this.m.root.position.copy(this.pos);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.5) this.m.root.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    this.m.root.rotation.z = this.state === 'stunned' && !this.frozen ? 1.2 : 0;
    this.slashT = Math.max(0, this.slashT - dt);
    this.anim.phase += dt * 3; this.anim.speed = this.vel.length();
    this.anim.slash = this.slashT > 0 ? 1 - this.slashT / 0.3 : this.state === 'windup' ? 0.15 : 0;
    animateSoldier(this.m, this.anim, dt);

    if (this.anchor && this.state !== 'stunned' && this.anchor.distanceTo(this.pos) < 70) {
      const from = this.pos.clone().setY(this.pos.y + 0.9);
      const len = from.distanceTo(this.anchor);
      this.rope.visible = true;
      this.rope.position.lerpVectors(from, this.anchor, 0.5);
      this.rope.scale.set(0.05, 0.05, len);
      this.rope.lookAt(this.anchor);
    } else this.rope.visible = false;
    if (this.state !== 'stunned' && Math.random() < 0.3) g.particles.puff(this.pos.x, this.pos.y + 0.8, this.pos.z, 0, 0, 0, 0.8, 0.5, 0xffffff, 0.4, 2);
  }

  kill() {
    this.dead = true;
    this.vel.set(rand(-6, 6), 8, rand(-6, 6));
    this.game.particles.blood(this.pos.x, this.pos.y + 1, this.pos.z, 25, 8);
  }

  dispose() { this.game.scene.remove(this.m.root, this.rope); }
}
