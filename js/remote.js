// Other players, drawn from network snapshots: interpolated position, pose, cables, name tag.
import * as THREE from 'three';
import { buildSoldier, animateSoldier } from './models.js';
import { NET } from './net/config.js';
import { angleDiff } from './util.js';

const CAPES = [0x2f6b3a, 0x3a4f7a, 0x7a2f2f, 0x6a4a8a, 0x2f6b6b, 0x8a6a2a, 0x4a4a4a, 0x7a3a5a];
const ropeGeo = new THREE.BoxGeometry(1, 1, 1);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
const HIP = new THREE.Vector3();
const QA = new THREE.Quaternion(), QB = new THREE.Quaternion();

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px Oswald, sans-serif';
  const w = Math.min(248, x.measureText(text).width + 24);
  x.fillStyle = 'rgba(10,12,16,.65)';
  x.fillRect((256 - w) / 2, 10, w, 44);
  x.fillStyle = color; x.fillRect((256 - w) / 2, 10, 4, 44);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 33);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

export class RemoteSoldier {
  constructor(game, id, name, index) {
    this.game = game; this.id = id; this.name = name;
    const cape = CAPES[index % CAPES.length];
    this.capeCss = '#' + cape.toString(16).padStart(6, '0');
    this.m = buildSoldier({ cape });
    game.scene.add(this.m.root);
    this.tag = nameTag(name, this.capeCss);
    game.scene.add(this.tag);
    this.ropes = [0, 1].map(() => { const r = new THREE.Mesh(ropeGeo, ropeMat); r.visible = false; game.scene.add(r); return r; });
    this.buf = [];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.anim = { phase: 0, run: 0, air: false, slash: 0, boost: 0, speed: 0, spin: false, fly: 0 };
    this.state = null;
    this.dead = false;
  }

  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z); }

  push(s, now) {
    this.buf.push({ t: now, s });
    if (this.buf.length > 30) this.buf.shift();
  }

  // Interpolate between the two snapshots around (now - delay).
  update(dt, now) {
    if (!this.buf.length) return;
    const rt = now - NET.interpDelay;
    let a = this.buf[0], b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= rt && this.buf[i + 1].t >= rt) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    const s = b.s, sa = a.s;
    this.state = s;
    this.dead = s.dead;
    this.pos.set(sa.pos[0] + (s.pos[0] - sa.pos[0]) * k, sa.pos[1] + (s.pos[1] - sa.pos[1]) * k, sa.pos[2] + (s.pos[2] - sa.pos[2]) * k);
    // past the newest snapshot: extrapolate briefly with velocity
    if (rt > b.t) { const e = Math.min(0.15, rt - b.t); this.pos.x += s.vel[0] * e; this.pos.y += s.vel[1] * e; this.pos.z += s.vel[2] * e; }
    this.vel.set(s.vel[0], s.vel[1], s.vel[2]);
    const facing = sa.facing + angleDiff(sa.facing, s.facing) * k;
    const r = this.m.root;
    r.visible = !s.dead && !s.grabbed;
    QA.set(...sa.quat); QB.set(...s.quat);
    r.quaternion.copy(QA).slerp(QB, k);
    const pivot = new THREE.Vector3(0, 0.9, 0);
    r.position.copy(this.pos).add(pivot).sub(pivot.clone().applyQuaternion(r.quaternion));
    const an = this.anim;
    an.air = s.air; an.run = s.run; an.fly = s.fly; an.slash = s.slash; an.slashDir = s.slashDir; an.spin = s.spin;
    an.boost = s.boost ? 1 : 0; an.speed = this.vel.length();
    an.phase += dt * (s.air ? 3 : an.run * 13);
    animateSoldier(this.m, an, dt);
    if (s.charged) { this.m.armL.rotation.set(-1.6, 0, 0.2); this.m.armR.rotation.set(-1.6, 0, -0.2); }
    this.m.auraMat.opacity = s.aura * 0.5;
    for (const au of this.m.auras) au.visible = s.aura > 0.02;

    this.tag.visible = !s.dead;
    this.tag.position.copy(this.pos).setY(this.pos.y + 2.6);

    for (let i = 0; i < 2; i++) {
      const [st, x, y, z] = s.hooks[i];
      const rope = this.ropes[i];
      if (st === 'none' || s.dead) { rope.visible = false; continue; }
      const side = i === 0 ? 1 : -1;
      HIP.set(side * 0.32, 0.8, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing).add(this.pos);
      const tip = new THREE.Vector3(x, y, z);
      const len = HIP.distanceTo(tip);
      rope.visible = len > 0.2;
      rope.position.lerpVectors(HIP, tip, 0.5);
      rope.scale.set(0.035, 0.035, len);
      rope.lookAt(tip);
    }
    if ((s.boost || s.brake || s.reel) && Math.random() < 0.6) {
      this.game.particles.puff(this.pos.x, this.pos.y + 0.8, this.pos.z, -this.vel.x * 0.1, -this.vel.y * 0.1, -this.vel.z * 0.1, 0.9, 0.6, 0xffffff, 0.5, 2.5);
    }
  }

  dispose() {
    this.game.scene.remove(this.m.root, this.tag, ...this.ropes);
  }
}
