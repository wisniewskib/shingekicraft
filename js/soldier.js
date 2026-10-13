// The player as a Survey Corps soldier.
// ODM model (from the anime / fan references): a trigger fires each anchor; holding the
// wire makes a pendulum (no gas); reeling the wire in is gas-driven and pulls you in a
// straight line; gas jets give thrust, mid-air steering and braking (reverse thrust).
import * as THREE from 'three';
import { buildSoldier, animateSoldier, updateBladeBlur } from './models.js';
import { moveAABB, collides } from './world.js';
import { audio } from './audio.js';
import { clamp, angleDiff, damp } from './util.js';

const ARC_LEN = Math.PI * 0.75;
const ARC_R = new THREE.Vector3(), ARC_U = new THREE.Vector3(), ARC_Z = new THREE.Vector3(0, 0, 1), ARC_M = new THREE.Matrix4(), ARC_Q = new THREE.Quaternion();
const GRAV = 24, RUN = 9.5, JUMP = 9.5, AIR_ACC = 11, BOOST = 19;
const MAX_SPEED = 38, SWING_CAP = 22, ZIP_SPEED = 34, ANCHOR_STOP = 1.6;
export const HOOK_RANGE = 95;
const HW = 0.3, HGT = 1.8;

const ropeGeo = new THREE.BoxGeometry(1, 1, 1);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
const headMat = new THREE.MeshLambertMaterial({ color: 0x9aa4ae });
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class Soldier {
  constructor(game) {
    this.game = game;
    this.m = buildSoldier();
    game.scene.add(this.m.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hooks = [0, 1].map((i) => {
      const rope = new THREE.Mesh(ropeGeo, ropeMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.3), headMat);
      rope.visible = head.visible = false;
      game.scene.add(rope, head);
      return { i, state: 'none', anchor: new THREE.Vector3(), from: new THREE.Vector3(), tip: new THREE.Vector3(), obj: null, local: new THREE.Vector3(), t: 0, dur: 0, len: 0, rope, head };
    });
    this.anim = { phase: 0, run: 0, air: false, slash: 0, boost: 0, speed: 0, spin: false, fly: 0 };
    this.spinRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 3.2, 40), new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spinRing.visible = false;
    game.scene.add(this.spinRing);
    this.prevTips = [new THREE.Vector3(), new THREE.Vector3()];
    this.reset();
  }

  reset() {
    this.hp = 100; this.gas = 100; this.blade = 100; this.sets = 6;
    this.vel.set(0, 0, 0);
    this.ground = false; this.slashT = 0; this.slashDur = 0.28; this.slashCd = 0; this.invuln = 0;
    this.lastDamage = -99; this.boosting = false; this.braking = false; this.dead = false;
    this.spin = []; this.facing = 0;
    this.bodyQ = new THREE.Quaternion();
    this.spinT = 0; this.spinCd = 0; this.spinAngle = 0; this.spinTick = 0; this.plunge = false;
    this.combo = 0; this.lastSlash = -9; this.finisher = false;
    this.eHeld = 0; this.charged = false; this.lungeT = 0; this.lungeTick = 0;
    this.dodgeT = 0; this.dodgeCd = 0; this.zipping = false; this.lastHookT = -9; this.grabbedBy = null; this.mash = 0;
    this.auraK = 0; this.tipsValid = false;
    if (this.spinRing) this.spinRing.visible = false;
    for (const h of this.hooks) this.detach(h);
    this.m.root.visible = true;
  }

  spawn(x, y, z, yaw = 0) { this.pos.set(x, y, z); this.facing = yaw; this.reset(); }

  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z); }
  get airborne() { return !this.ground; }
  get speed() { return this.vel.length(); }
  get attacking() { return this.slashT > 0 || this.spinT > 0 || this.lungeT > 0; }
  anyHooked() { return this.hooks.some((h) => h.state === 'attached'); }

  hipWorld(i, out) {
    const s = i === 0 ? 1 : -1;
    out.set(s * 0.32, 0.8, 0).applyAxisAngle(UP, this.facing).add(this.pos);
    return out;
  }

  fireHook(h) {
    const g = this.game;
    const o = g.camera.position, d = g.camDir;
    // nudge the left/right hook apart a little so a double-shot reads as two cables
    const side = new THREE.Vector3(Math.cos(g.camYaw), 0, -Math.sin(g.camYaw)).multiplyScalar(h.i === 0 ? -0.012 : 0.012);
    const dir = d.clone().add(side).normalize();
    const hit = g.hookTarget(o, dir, HOOK_RANGE + 6);
    this.hipWorld(h.i, h.from);
    h.tip.copy(h.from);
    if (hit) {
      h.state = 'flying';
      h.anchor.copy(hit.point);
      h.obj = hit.object || null;
      if (h.obj) h.local.copy(h.obj.worldToLocal(hit.point.clone()));
      h.dur = Math.max(0.05, h.from.distanceTo(hit.point) / 190);
    } else {
      h.state = 'miss';
      h.obj = null;
      h.anchor.copy(o).addScaledVector(dir, HOOK_RANGE * 0.6);
      h.dur = 0.22;
    }
    h.t = 0;
    audio.play('hook');
  }

  detach(h) { h.state = 'none'; h.obj = null; h.rope.visible = false; h.head.visible = false; }

  hit(amount, from, knock = true) {
    if (this.dead) return;
    if (this.dodgeT > 0) { this.game.hud.toast('UNIK!'); return; }
    if (this.invuln > 0) return;
    this.hp -= amount;
    this.invuln = 0.9; this.lastDamage = this.game.time;
    if (knock) {
      const k = this.pos.clone().sub(from).setY(0).normalize().multiplyScalar(18);
      this.vel.add(k).setY(10);
      for (const h of this.hooks) this.detach(h);
    }
    audio.play('hurt');
    this.game.onPlayerHurt(amount);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onPlayerDeath(); }
  }

  // A titan's hand closes around you: mash F (or E) to cut yourself free.
  grab(titan) {
    if (this.dead || this.grabbedBy) return;
    if (this.dodgeT > 0) { this.game.hud.toast('UNIK!'); return; }
    if (this.invuln > 0) return;
    this.grabbedBy = titan; this.mash = 0; this.grabT = 0;
    for (const h of this.hooks) this.detach(h);
    this.vel.set(0, 0, 0);
    audio.play('hurt'); audio.play('roar', 0.6);
    this.game.onPlayerHurt(10);
  }

  updateGrabbed(dt, input) {
    const g = this.game, t = this.grabbedBy;
    this.grabT += dt;
    this.hp -= 11 * dt; this.lastDamage = g.time;
    if (input.pressed('KeyF') || input.pressed('KeyE')) {
      this.mash++;
      audio.play('slash', 0.5);
      const hand = t.handWorld();
      g.particles.blood(hand.x, hand.y, hand.z, 6, 5);
    }
    const free = this.mash >= 7 || t.dead || t.limp[t.attackArm] > 0;
    if (free) {
      if (!t.dead && this.mash >= 7) { const hand = t.handWorld(); g.hud.feed(t.cutPart(t.attackArm === 'L' ? 'armL' : 'armR', hand)); }
      this.grabbedBy = null;
      g.onGrabEnd(t, this.mash >= 7);
      this.invuln = 1.2;
      this.vel.copy(this.pos.clone().sub(t.pos).setY(0).normalize().multiplyScalar(14)).setY(12);
      g.hud.toast('UWOLNIONY!');
      audio.play('cut');
      return false;
    }
    if (this.hp <= 0 || this.grabT > 3.2) {
      this.hp = 0; this.dead = true; this.grabbedBy = null; g.onGrabEnd(t, false); g.onPlayerDeath(); return true;
    }
    const hand = t.handWorld();
    this.pos.set(hand.x, hand.y - 1.2, hand.z);
    this.m.root.position.copy(this.pos);
    this.m.root.rotation.set(0, t.yaw + Math.PI, 0);
    this.m.armL.rotation.set(-2.6, 0, 0.3); this.m.armR.rotation.set(-2.6, 0, -0.3);
    return true;
  }

  update(dt, input) {
    const g = this.game;
    if (this.dead) { this.m.root.visible = false; for (const h of this.hooks) this.detach(h); this.spinRing.visible = false; return; }
    if (this.grabbedBy && this.updateGrabbed(dt, input)) { audio.setGas(0); return; }
    this.invuln = Math.max(0, this.invuln - dt);
    this.slashCd = Math.max(0, this.slashCd - dt);
    this.spinCd = Math.max(0, this.spinCd - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    if (g.time - this.lastDamage > 6) this.hp = Math.min(100, this.hp + 4 * dt);

    // ---- input ----
    const yaw = g.camYaw;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = f.clone().multiplyScalar(input.moveY()).add(r.clone().multiplyScalar(input.moveX()));
    if (wish.lengthSq() > 1) wish.normalize();

    // LMB = left hook, RMB = right hook (hold the trigger to keep the wire)
    const want = [input.held('Mouse0'), input.held('Mouse2')];
    const fresh = [input.pressed('Mouse0'), input.pressed('Mouse2')];
    for (const h of this.hooks) {
      if (fresh[h.i]) this.fireHook(h);
      else if (!want[h.i] && (h.state === 'attached' || h.state === 'flying')) this.detach(h);
    }
    for (const h of this.hooks) {
      if (h.state === 'none') continue;
      if (h.obj) {
        const t = h.obj.userData.titan;
        if (t && t.dead) { this.detach(h); continue; }
        h.anchor.copy(h.obj.localToWorld(h.local.clone()));
      }
      this.hipWorld(h.i, h.from);
      h.t += dt;
      if (h.state === 'flying') {
        const k = Math.min(1, h.t / h.dur);
        h.tip.lerpVectors(h.from, h.anchor, k);
        if (k >= 1) { h.state = 'attached'; h.len = this.chest.distanceTo(h.anchor); audio.play('hookHit', 0.8); }
      } else if (h.state === 'miss') {
        const k = h.t / h.dur;
        h.tip.lerpVectors(h.from, h.anchor, k < 0.5 ? k * 2 : 2 - k * 2);
        if (k >= 1) this.detach(h);
      } else h.tip.copy(h.anchor);
    }

    // ---- movement ----
    const hooked = this.hooks.filter((h) => h.state === 'attached');
    const v = this.vel;
    const reelKey = input.held('ShiftLeft') || input.held('ShiftRight');
    const brakeKey = input.held('KeyG') || input.held('KeyC');
    this.boosting = false; this.braking = false;
    // reelK: 0 = light auto-reel that keeps swings lively, 1 = Shift winds the wire in hard
    const reelK = reelKey && hooked.length && this.gas > 0 ? 1 : 0;
    this.zipping = reelK > 0;
    // Shift + Space: fire the winch and the gas together and fly straight at the anchor
    const zip = reelK > 0 && input.held('Space');
    const gravity = this.lungeT <= 0 && !zip;

    if (this.ground && !hooked.length) {
      const k = 1 - Math.exp(-14 * dt);
      v.x += (wish.x * RUN - v.x) * k;
      v.z += (wish.z * RUN - v.z) * k;
      if (input.pressed('Space')) { v.y = JUMP; this.ground = false; }
    } else {
      v.addScaledVector(wish, AIR_ACC * dt);
      if (this.ground && input.pressed('Space')) v.y = Math.max(v.y, JUMP);
      if (input.held('Space') && this.gas > 0 && !zip) {
        const dir = g.camDir.clone();
        // looking down at a target shouldn't drive you into the ground: soften the downward part
        if (dir.y < 0) { dir.y *= 0.4; dir.normalize(); }
        if (hooked.length) {
          // on a wire the gas pushes across the cable: it speeds up the swing, Shift is what reels you in
          const n = new THREE.Vector3();
          for (const h of hooked) n.add(h.anchor.clone().sub(this.chest).normalize());
          n.normalize();
          const across = dir.clone().addScaledVector(n, -dir.dot(n));
          if (across.lengthSq() > 0.05) dir.copy(across.normalize());
          if (dir.y < 0) { dir.y *= 0.4; dir.normalize(); }
        }
        // gas pushes hard from low speed but fades out towards ~30 m/s along the boost direction
        const along = v.dot(dir);
        const k = along < 12 ? 1.4 : along > 26 ? 0.15 : 1.4 - ((along - 12) / 14) * 1.25;
        v.addScaledVector(dir, BOOST * k * dt);
        v.y += 4 * dt;
        if (v.y < -6) v.y += Math.min(-v.y - 6, 50 * dt); // boosting while dropping cushions the fall
        this.gas = Math.max(0, this.gas - 7 * dt);
        this.boosting = true;
      }
    }
    // landing thrusters (G / C): kill a fall fast and bleed off speed; they also fire by
    // themselves just before a hard landing if there's gas in the tanks
    const autoThrust = !this.ground && v.y < -20 && this.gas > 0 && g.world.raycast(this.pos.x, this.pos.y, this.pos.z, 0, -1, 0, Math.min(12, -v.y * 0.35)) !== null;
    if ((brakeKey || autoThrust) && this.gas > 0) {
      if (v.y < -2) v.y += Math.min(-v.y - 2, 110 * dt);
      if (!hooked.length) { const k = Math.min(1, 2.4 * dt); v.x -= v.x * k; v.z -= v.z * k; if (!this.ground) v.y -= v.y > 0 ? v.y * k : 0; }
      this.gas = Math.max(0, this.gas - 2.5 * dt);
      this.braking = true;
    }

    // dodge: a short sideways gas burst with a moment of invulnerability
    if (input.pressed('KeyF') && this.dodgeCd <= 0 && !this.grabbedBy) {
      if (this.gas >= 4) {
        const dir = wish.lengthSq() > 0.01 ? wish.clone().normalize() : f.clone().negate();
        v.addScaledVector(dir, 20); v.y = Math.max(v.y, 3);
        this.gas -= 4; this.dodgeT = 0.35; this.dodgeCd = 0.9;
        audio.play('hook', 0.7);
        for (let i = 0; i < 8; i++) g.particles.puff(this.pos.x, this.pos.y + 0.8, this.pos.z, -dir.x * 6 + (Math.random() - 0.5) * 3, Math.random() * 2, -dir.z * 6 + (Math.random() - 0.5) * 3, 1.2, 0.5, 0xffffff, 0.6, 2);
      } else g.hud.toast('BRAK GAZU');
    }

    if (gravity) v.y -= GRAV * dt;

    const chest = this.chest;
    for (const h of hooked) {
      const to = h.anchor.clone().sub(chest);
      const dist = to.length();
      if (dist < 0.01) continue;
      const n = to.divideScalar(dist);
      // the winch: always a light pull, Shift winds in hard
      const reel = this.gas > 0 ? 5.5 + 22 * reelK : 0;
      h.len = Math.max(ANCHOR_STOP, Math.min(h.len, dist) - reel * dt);
      if (this.gas > 0) v.addScaledVector(n, (5 + 35 * reelK) * dt);
      // gear brake: arrive at the anchor instead of splatting into it
      const vr = v.dot(n), room = Math.max(0, dist - ANCHOR_STOP);
      const vmax = Math.sqrt(2 * 55 * room) + 3;
      if (vr > vmax) v.addScaledVector(n, -(vr - vmax) * Math.min(1, 14 * dt));
      // pump the swing with W
      if (input.moveY() > 0) {
        const tang = v.clone().addScaledVector(n, -v.dot(n));
        const tl = tang.length();
        if (tl > 2) v.addScaledVector(tang, (5 * dt) / tl);
      }
    }
    if (zip) {
      const to = new THREE.Vector3();
      for (const h of hooked) to.add(h.anchor);
      to.divideScalar(hooked.length).sub(chest);
      const dist = to.length();
      if (dist > 0.01) {
        to.divideScalar(dist);
        // full speed in a straight line, easing off as the anchor comes close
        const room = dist - ANCHOR_STOP;
        const want = room > 0.4 ? Math.min(ZIP_SPEED, Math.sqrt(2 * 55 * room) + 2) : 0;
        v.lerp(to.multiplyScalar(want), 1 - Math.exp(-7 * dt));
      }
      this.gas = Math.max(0, this.gas - 5 * dt);
      this.boosting = true;
    }
    if (hooked.length) this.gas = Math.max(0, this.gas - (0.35 + 3.15 * reelK) * dt);
    this.reeling = reelK > 0;
    // a long swing alone shouldn't snowball into silly speeds: bleed off anything above the cap
    // (gas on the wire doesn't get around it either; reeling in with Shift may go a bit faster)
    if (hooked.length && !zip) {
      const sp = v.length(), cap = this.reeling ? SWING_CAP + 8 : SWING_CAP;
      if (sp > cap) v.multiplyScalar(1 - Math.min(0.5, ((sp - cap) / sp) * 16 * dt));
    }
    // air drag grows with speed
    const spd = v.length();
    if (!this.ground) v.multiplyScalar(1 - Math.min(0.5, (0.015 + spd * 0.0011) * dt));
    // taut wire: no moving away from the anchor; small correction pulls you back onto the arc
    for (const h of hooked) {
      const to = h.anchor.clone().sub(this.chest);
      const dist = to.length();
      if (dist <= h.len || dist < 0.01) continue;
      const n = to.divideScalar(dist);
      const vr = v.dot(n);
      if (vr < 0) v.addScaledVector(n, -vr);
      const need = Math.min(10, (dist - h.len) * 5);
      if (v.dot(n) < need) v.addScaledVector(n, need - v.dot(n));
    }

    // ---- special attacks ----
    if (input.pressed('KeyQ') && this.spinCd <= 0 && this.spinT <= 0) {
      if (this.gas >= 8 && this.blade > 0) {
        this.spinT = 0.8; this.spinCd = 2.2; this.gas -= 8; this.spinTick = 0;
        audio.play('slash'); audio.play('hook', 0.6);
      } else g.hud.toast(this.blade > 0 ? 'BRAK GAZU' : 'TĘPE OSTRZA · R');
    }
    if (this.spinT > 0) {
      this.spinT -= dt;
      const tgt = g.spinTarget(this);
      const dir = tgt ? tgt.clone().sub(this.chest).normalize() : g.camDir.clone();
      v.lerp(dir.multiplyScalar(36), 1 - Math.exp(-6 * dt));
      this.spinAngle += dt * 28;
      this.spinTick -= dt;
      if (this.spinTick <= 0) { this.spinTick = 0.1; g.spinHit(this, 'MŁYNEK'); audio.play('slash', 0.35); }
      if (this.spinT <= 0) this.spinAngle = 0;
    }
    if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.lungeTick -= dt;
      if (this.lungeTick <= 0) { this.lungeTick = 0.05; g.spinHit(this, 'PCHNIĘCIE'); }
    }

    if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);
    const preV = v.clone();
    const res = moveAABB(g.world, this.pos, v, dt, HW, HGT, true);
    // hard landings and wall slams hurt (not while on the wire: reeling into things is normal)
    if (res.impact > 26 && !hooked.length && g.time - this.lastHookT > 0.4 && this.lungeT <= 0 && this.spinT <= 0) {
      const dmg = Math.round((res.impact - 26) * 2.5);
      if (dmg > 0) { this.hit(dmg, this.pos, false); g.hud.toast(res.hitY ? 'TWARDE LĄDOWANIE' : 'UDERZENIE'); }
    }
    if (hooked.length) this.lastHookT = g.time;
    this.ground = res.ground;
    if (this.ground && v.y < 0) v.y = 0;
    if (this.pos.y < -10) { this.pos.y = g.world.topY(this.pos.x, this.pos.z) + 1; v.set(0, 0, 0); }

    // camera rotation history (for the SPIN bonus)
    const dyaw = Math.abs(angleDiff(this.prevYaw ?? yaw, yaw));
    this.prevYaw = yaw;
    this.spin.push([g.time, dyaw]);
    while (this.spin.length && g.time - this.spin[0][0] > 0.9) this.spin.shift();

    // ---- blades: E = combo slash, hold E = charged lunge ----
    if (input.pressed('KeyE')) {
      this.eHeld = 0; this.charged = false;
      if (this.slashCd <= 0) this.doSlash();
    }
    if (input.held('KeyE')) {
      this.eHeld += dt;
      if (!this.charged && this.eHeld > 0.4 && this.blade > 0) { this.charged = true; audio.play('harden', 0.5); }
    }
    if (input.released('KeyE')) {
      if (this.charged) this.lunge();
      this.charged = false;
    }
    if (input.pressed('KeyR')) this.reload();
    if (this.blade <= 0 && this.sets > 0) this.reload();
    this.slashT = Math.max(0, this.slashT - dt);

    // ---- model ----
    const hs = Math.hypot(v.x, v.z);
    if (this.slashT > 0 || this.charged) this.facing += angleDiff(this.facing, yaw + Math.PI) * Math.min(1, 20 * dt);
    else if (hs > 1.5) this.facing += angleDiff(this.facing, Math.atan2(v.x, v.z)) * Math.min(1, 12 * dt);
    else this.facing += angleDiff(this.facing, yaw + Math.PI) * Math.min(1, 6 * dt);

    // Body orientation, built from an "up" (head) and a "front" (chest) direction:
    //   on a wire  -> head towards the anchor, chest along the swing (you hang from the cable)
    //   fast flight-> head along the velocity, chest to the ground ("Superman")
    //   otherwise  -> upright, facing where you move
    const sp = v.length();
    const fly = !this.ground ? clamp((sp - 10) / 14, 0, 1) : 0;
    const flat = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const U = UP.clone(), F = flat.clone();
    if (!this.ground && hooked.length && !this.attacking) {
      const anchor = new THREE.Vector3();
      for (const h of hooked) anchor.add(h.anchor);
      const toA = anchor.divideScalar(hooked.length).sub(this.chest).normalize();
      U.lerp(toA, 0.75).normalize();
      const tang = v.clone().addScaledVector(toA, -v.dot(toA));
      if (tang.lengthSq() > 4) F.copy(tang.normalize());
    } else if (fly > 0) {
      const k = fly * (this.slashT > 0 ? 0.5 : 1) * (this.spinT > 0 ? 0.6 : 1);
      U.lerp(v.clone().normalize(), k).normalize();
      F.lerp(DOWN, k).normalize();
    }
    let Z = F.clone().addScaledVector(U, -F.dot(U));
    if (Z.lengthSq() < 1e-3) Z = flat.clone().addScaledVector(U, -flat.dot(U));
    if (Z.lengthSq() < 1e-3) Z = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).addScaledVector(U, -0.0);
    Z.normalize();
    const X = new THREE.Vector3().crossVectors(U, Z).normalize();
    Z.crossVectors(X, U);
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, Z));
    this.bodyQ.slerp(target, 1 - Math.exp(-10 * dt));
    let whirl = 0;
    if (this.finisher && this.slashT > 0) whirl = (1 - this.slashT / this.slashDur) * Math.PI * 2 * -this.slashDir;
    // spins happen around the body's own long axis
    const spinQ = new THREE.Quaternion().setFromAxisAngle(UP, this.spinAngle + whirl);
    this.m.root.quaternion.copy(this.bodyQ).multiply(spinQ);
    // rotate around the hips, not the feet
    const pivot = new THREE.Vector3(0, 0.9, 0);
    this.m.root.position.copy(this.pos).add(pivot).sub(pivot.clone().applyQuaternion(this.m.root.quaternion));

    const a = this.anim;
    a.air = !this.ground; a.speed = sp; a.run = this.ground ? clamp(hs / RUN, 0, 1) : 0;
    a.fly = fly;
    a.phase += dt * (this.ground ? hs * 1.4 : 3);
    a.slash = this.slashT > 0 && !this.finisher ? 1 - this.slashT / this.slashDur : 0;
    a.slashDir = this.slashDir || 1;
    a.boost = this.boosting ? 1 : 0;
    a.spin = this.spinT > 0 || (this.finisher && this.slashT > 0) || this.lungeT > 0;
    animateSoldier(this.m, a, dt);
    if (this.lungeT > 0 || this.charged) { this.m.armL.rotation.set(-1.6, 0, 0.2); this.m.armR.rotation.set(-1.6, 0, -0.2); }
    this.m.root.updateMatrixWorld(true);
    updateBladeBlur(this.m, v);
    this.updateSlashFx(dt);
    this.updateAura(dt);

    this.spinRing.visible = this.spinT > 0 || (this.finisher && this.slashT > 0);
    if (this.spinRing.visible) {
      this.spinRing.position.copy(this.chest);
      const ringQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0).applyQuaternion(this.bodyQ));
      this.spinRing.quaternion.copy(ringQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.spinAngle + whirl));
      this.spinRing.material.opacity = 0.3 + 0.2 * Math.sin(g.time * 40);
    }
    if (this.invuln > 0) this.m.root.visible = Math.floor(g.time * 20) % 2 === 0; else this.m.root.visible = true;

    // ropes
    for (const h of this.hooks) {
      if (h.state === 'none') continue;
      const len = h.from.distanceTo(h.tip);
      h.rope.visible = h.head.visible = len > 0.2;
      h.rope.position.lerpVectors(h.from, h.tip, 0.5);
      h.rope.scale.set(0.035, 0.035, len);
      h.rope.lookAt(h.tip);
      h.head.position.copy(h.tip);
      h.head.lookAt(h.from);
    }

    // gas effects
    audio.setGas(this.boosting || this.braking ? 1 : this.reeling ? 0.45 : 0);
    audio.setWind(sp);
    if ((this.boosting || this.braking) && Math.random() < 0.8) {
      const dirN = v.clone().normalize();
      const b = this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)).addScaledVector(dirN, this.braking ? 0.8 : -0.6);
      const s = this.braking ? 0.25 : -0.1;
      g.particles.puff(b.x, b.y, b.z, v.x * s, v.y * s, v.z * s, 0.9, 0.6, 0xffffff, 0.5, 2.5);
    }
  }

  doSlash() {
    const g = this.game, now = g.time;
    this.combo = now - this.lastSlash < 0.7 ? (this.combo % 3) + 1 : 1;
    this.lastSlash = now;
    this.finisher = this.combo === 3;
    this.slashDur = this.finisher ? 0.42 : 0.28;
    this.slashT = this.slashDur;
    this.slashCd = this.finisher ? 0.45 : 0.2;
    this.plunge = !this.ground && this.vel.y < -14;
    this.slashDir = -(this.slashDir || 1);
    this.slashFx();
    audio.play('slash');
    if (this.finisher) audio.play('slash', 0.8);
    g.hud.combo(this.combo);
    g.trySlash(this, { finisher: this.finisher });
  }

  lunge() {
    const g = this.game;
    if (this.gas < 6 || this.blade <= 0) { g.hud.toast(this.blade > 0 ? 'BRAK GAZU' : 'TĘPE OSTRZA · R'); return; }
    const dir = g.lungeTarget(this) || g.camDir.clone();
    this.vel.copy(dir.multiplyScalar(44));
    this.lungeT = 0.4; this.lungeTick = 0; this.gas -= 6;
    audio.play('slash'); audio.play('hook', 0.8);
    g.shake(0.25);
  }

  // Blade aura + light trail behind both blade tips while attacking.
  updateAura(dt) {
    const want = this.attacking || this.charged ? 1 : 0;
    this.auraK = damp(this.auraK, want, want ? 25 : 8, dt);
    const pulse = this.charged ? 0.25 * Math.sin(this.game.time * 30) : 0;
    this.m.auraMat.opacity = this.auraK * (0.5 + pulse);
    for (const au of this.m.auras) au.visible = this.auraK > 0.02;
    if (!this.attacking) { this.tipsValid = false; return; }
    const px = this.m.px;
    this.m.root.updateMatrixWorld(true);
    this.m.auras.forEach((au, i) => {
      const tip = au.localToWorld(new THREE.Vector3(0, 0, 16 * px));
      if (this.tipsValid) {
        const prev = this.prevTips[i];
        for (let k = 0; k < 3; k++) {
          const p = prev.clone().lerp(tip, k / 3);
          this.game.particles.puff(p.x, p.y, p.z, 0, 0, 0, 0.5, 0.2, 0xdff8ff, 0.85, 0.2);
        }
      }
      this.prevTips[i].copy(tip);
    });
    this.tipsValid = true;
  }

  // White crescent that sweeps across in front of the soldier (bigger = blade aura reach).
  slashFx() {
    if (!this.arc) {
      this.arc = new THREE.Mesh(new THREE.RingGeometry(1.4, 3.6, 32, 1, 0, ARC_LEN),
        new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.game.scene.add(this.arc);
    }
    this.arcT = 0;
  }
  updateSlashFx(dt) {
    if (!this.arc || this.arcT === undefined || this.arcT > 0.22) { if (this.arc) this.arc.visible = false; return; }
    this.arcT += dt;
    const k = this.arcT / 0.22;
    const g = this.game;
    this.arc.visible = true;
    // the crescent lies in the cutting plane (spanned by the view direction and the camera's right),
    // tilted a little for a diagonal cut, and sweeps across the same way the torso whips
    const fwd = g.camDir, d = this.slashDir || 1;
    const right = ARC_R.crossVectors(fwd, UP).normalize();
    const up = ARC_U.crossVectors(right, fwd);
    const tilt = this.finisher ? 0 : d * 0.35;
    right.applyAxisAngle(fwd, tilt); up.applyAxisAngle(fwd, tilt);
    this.arc.quaternion.setFromRotationMatrix(ARC_M.makeBasis(right, fwd, up));
    const e = 1 - (1 - k) * (1 - k);
    const centre = Math.PI / 2 + d * (this.finisher ? 1.6 - 3.2 * e : 0.95 - 1.9 * e);
    this.arc.quaternion.multiply(ARC_Q.setFromAxisAngle(ARC_Z, centre - ARC_LEN / 2));
    this.arc.position.copy(this.chest).addScaledVector(fwd, 0.3).addScaledVector(up, -0.1);
    this.arc.material.opacity = 0.75 * (1 - k);
    this.arc.scale.setScalar((this.finisher ? 1.2 : 0.9) + k * 0.4);
  }

  reload() {
    if (this.sets <= 0 || this.blade >= 100) return false;
    this.sets--; this.blade = 100;
    audio.play('clang');
    this.game.hud.toast('ŚWIEŻE OSTRZA');
    return true;
  }

  resupply() {
    if (this.gas > 99 && this.sets >= 6 && this.blade >= 100) return false;
    this.gas = 100; this.sets = 6; this.blade = 100;
    return true;
  }

  dispose() {
    this.game.scene.remove(this.m.root, this.spinRing);
    if (this.arc) this.game.scene.remove(this.arc);
    for (const h of this.hooks) this.game.scene.remove(h.rope, h.head);
  }
}

export { collides };
