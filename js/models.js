// Blocky character models (Minecraft proportions: 32 "pixels" tall).
import * as THREE from 'three';
import { makeTitanFace, makeEmblemTexture, makeSoldierFace } from './textures.js';
import { mulberry32, pick } from './util.js';

const boxCache = new Map();
function box(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(w, h, d));
  return boxCache.get(k);
}
const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

// A limb pivots at its top; the mesh hangs below the pivot.
function limb(parent, w, h, d, material, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = new THREE.Mesh(box(w, h, d), material);
  m.position.y = -h / 2;
  m.castShadow = true;
  pivot.add(m);
  parent.add(pivot);
  return pivot;
}

// ---------------- Soldier ----------------
let wingsTex = null;
const faceCache = new Map();

export function buildSoldier(opts = {}) {
  const px = 1.8 / 32;
  const P = (v) => v * px;
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts as a whole while flying
  body.position.y = P(12);
  root.add(body);
  const skinHex = opts.skinHex || '#e8b48c', hairHex = opts.hairHex || '#2a1a10';
  const skin = mat(opts.skin || 0xe8b48c), shirt = mat(0xf1ede3), jacket = mat(0x8c5a30), jacketDark = mat(0x6e4524);
  const pants = mat(0xeee9dc), boots = mat(0x3b2618), leather = mat(0x4a3020), hair = mat(opts.hair || 0x2a1a10);
  const capeCol = opts.cape || 0x2f6b3a;
  const cape = new THREE.MeshLambertMaterial({ color: capeCol, side: THREE.DoubleSide });
  const capeIn = mat(new THREE.Color(capeCol).multiplyScalar(0.7).getHex());
  const steel = mat(0xc9d3dc), gunmetal = mat(0x5d6670), dark = mat(0x2c3036), gold = mat(0xb89a4a);
  if (!wingsTex) wingsTex = makeEmblemTexture();
  const emblem = new THREE.MeshBasicMaterial({ map: wingsTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  const fk = skinHex + hairHex;
  if (!faceCache.has(fk)) faceCache.set(fk, new THREE.MeshLambertMaterial({ map: makeSoldierFace(skinHex, hairHex) }));
  const face = faceCache.get(fk);
  const add = (parent, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(box(P(w), P(h), P(d)), m); o.position.set(P(x), P(y), P(z)); parent.add(o); return o; };

  // torso: white shirt, short brown jacket, harness straps, belt
  add(body, 8, 12, 4, shirt, 0, 6, 0);
  add(body, 8.5, 6.5, 4.5, jacket, 0, 9, 0);
  add(body, 2.2, 6.6, 0.3, shirt, 0, 9, 2.3); // open jacket front
  add(body, 8.7, 1, 4.7, jacketDark, 0, 5.9, 0); // jacket hem
  for (const sx of [-2.4, 2.4]) add(body, 0.7, 12, 0.3, leather, sx, 6, 2.15); // chest straps
  add(body, 6, 0.7, 0.3, leather, 0, 7.5, 2.2);
  add(body, 8.8, 1.3, 4.8, leather, 0, 1.4, 0); // belt
  add(body, 1.4, 1.3, 0.3, gold, 0, 1.4, 2.45); // buckle
  const back = new THREE.Mesh(new THREE.PlaneGeometry(P(5), P(5)), emblem);
  back.position.set(0, P(9.2), P(-2.3)); back.rotation.y = Math.PI;
  body.add(back);

  // ODM gear: back unit, gas tanks on the hips, anchor launchers, blade sheaths
  add(body, 5, 3, 2, gunmetal, 0, 1.5, -3);
  const tankGeo = new THREE.CylinderGeometry(P(1.3), P(1.3), P(8), 10);
  for (const sx of [-1, 1]) {
    const tank = new THREE.Mesh(tankGeo, steel);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(P(sx * 5.2), P(1.2), P(-2.2));
    body.add(tank);
    add(body, 1.6, 1.6, 2.2, dark, sx * 5.2, 2.6, 0.6); // anchor launcher
    add(body, 1.8, 6.5, 4.6, gunmetal, sx * 5.4, -2.5, -0.2); // blade box (sheath)
    add(body, 1.9, 0.6, 4.7, steel, sx * 5.4, 0.6, -0.2);
  }

  // head: face texture, undercut hair, hood at the back of the neck
  const neck = new THREE.Group();
  neck.position.y = P(12);
  body.add(neck);
  const head = new THREE.Mesh(box(P(8), P(8), P(8)), [skin, skin, hair, skin, face, hair]);
  head.position.y = P(4);
  neck.add(head);
  add(neck, 8.6, 2.6, 8.6, hair, 0, 7.4, 0);
  add(neck, 8.6, 4.5, 1.4, hair, 0, 5, -3.8);
  add(neck, 1, 3, 6, hair, 4.1, 5.6, -0.6); add(neck, 1, 3, 6, hair, -4.1, 5.6, -0.6);
  add(neck, 3.2, 1.5, 1, hair, 1.8, 6.2, 4.1); // fringe
  add(neck, 7, 2.6, 2.6, capeIn, 0, 0.6, -3.2); // hood

  // arms: jacket sleeves, cuffs, gloves, sword handles + blades + aura
  const armL = limb(body, P(4), P(12), P(4), jacket, P(6), P(11.5), 0);
  const armR = limb(body, P(4), P(12), P(4), jacket, P(-6), P(11.5), 0);
  const auraMat = new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const auras = [], grips = [];
  const ghostMats = [0.32, 0.16].map((o) => new THREE.MeshBasicMaterial({ color: 0xe6eef6, transparent: true, opacity: o, depthWrite: false, userData: { base: o } }));
  for (const a of [armL, armR]) {
    add(a, 4.3, 1.2, 4.3, jacketDark, 0, -8, 0);
    add(a, 4.2, 3.4, 4.2, leather, 0, -10.6, 0); // glove
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(P(3), P(3)), emblem);
    patch.position.set(a === armL ? P(2.05) : P(-2.05), P(-3), 0); patch.rotation.y = a === armL ? Math.PI / 2 : -Math.PI / 2;
    a.add(patch);
    add(a, 1.6, 1.6, 5, dark, 0, -12, 1.5); // handle with trigger guard
    // the blade sits on a grip pivot so it can swing from pointing forward to trailing back in flight
    const grip = new THREE.Group();
    grip.position.set(0, P(-12), P(1.5));
    a.add(grip);
    const blade = add(grip, 0.45, 1.4, 20, steel, 0, 0, 12);
    add(grip, 0.5, 0.5, 20, mat(0xffffff), 0, 0.7, 12); // bright edge
    a.userData.blade = blade;
    const aura = new THREE.Mesh(box(P(3), P(4), P(34)), auraMat);
    aura.position.set(0, 0, P(12.5));
    grip.add(aura);
    auras.push(aura);
    // motion-blur ghosts: faint copies of the blade left behind at speed
    grip.userData.ghosts = ghostMats.map((gm) => {
      const gh = new THREE.Mesh(blade.geometry, gm);
      gh.visible = false;
      grip.add(gh);
      return gh;
    });
    grip.userData.bladePos = blade.position.clone();
    grips.push(grip);
  }

  // legs: white pants, thigh straps, knee-high boots
  const legL = limb(root, P(4), P(12), P(4), pants, P(2), P(12), 0);
  const legR = limb(root, P(4), P(12), P(4), pants, P(-2), P(12), 0);
  for (const l of [legL, legR]) {
    add(l, 4.4, 6.5, 4.4, boots, 0, -8.8, 0);
    add(l, 4.6, 1, 4.6, leather, 0, -5.3, 0);
    add(l, 4.5, 0.7, 4.5, leather, 0, -2, 0);
    add(l, 4.5, 0.7, 4.5, leather, 0, -3.6, 0);
    add(l, 4.5, 1, 5, boots, 0, -11.6, 0.4); // toe
  }

  // cape with the emblem, hanging from the shoulders
  const capeP = new THREE.Group();
  capeP.position.set(0, P(12), P(-2.6));
  body.add(capeP);
  const capeM = new THREE.Mesh(new THREE.PlaneGeometry(P(10), P(17)), cape);
  capeM.position.y = P(-8.5);
  capeP.add(capeM);
  const capeEm = new THREE.Mesh(new THREE.PlaneGeometry(P(6), P(6)), emblem);
  capeEm.position.set(0, P(-7), P(-0.02));
  capeEm.rotation.y = Math.PI;
  capeP.add(capeEm);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, neck, armL, armR, legL, legR, cape: capeP, px, auraMat, auras, grips, ghostMats };
}

export function animateSoldier(m, s, dt) {
  // s: { run (0..1 speed), phase, air, slash (0..1), boost }
  const sw = Math.sin(s.phase) * 0.9 * s.run;
  if (!s.air) {
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    m.armL.rotation.x = -sw * 0.8; m.armR.rotation.x = sw * 0.8;
    m.body.rotation.x = s.run * 0.15;
  } else {
    const fl = s.fly || 0, fa = Math.min(1, fl * 1.6);
    m.legL.rotation.x = 0.5 * (1 - fl) + 0.08 * fl; m.legR.rotation.x = 0.2 * (1 - fl) + 0.15 * fl;
    // arms sweep back along the body in fast flight
    m.armL.rotation.x = 0.9 * (1 - fa) + 0.55 * fa; m.armR.rotation.x = 0.9 * (1 - fa) + 0.55 * fa;
    m.armL.rotation.z = 0.5 * (1 - fl) + 0.25 * fl; m.armR.rotation.z = -0.5 * (1 - fl) - 0.25 * fl;
    m.body.rotation.x = (0.35 + s.boost * 0.4) * (1 - fl);
  }
  m.armL.rotation.y = 0; m.armR.rotation.y = 0;
  if (!s.air) { m.armL.rotation.z = 0.1; m.armR.rotation.z = -0.1; }
  if (s.slash > 0) {
    // a real sweep: arms out with the blades forward, torso coils to one side then whips across
    // (alternating left-to-right and right-to-left, each slightly diagonal)
    const d = s.slashDir || 1, t = s.slash;
    let twist, spread, lean, roll;
    if (t < 0.22) { const k = t / 0.22; twist = 0.95 * d * k; spread = 1.25 * k; lean = -0.12 * k; roll = 0.18 * d * k; }
    else if (t < 0.62) { const k = (t - 0.22) / 0.4, e = 1 - (1 - k) * (1 - k) * (1 - k); twist = d * (0.95 - 2.15 * e); spread = 1.25; lean = -0.12 + 0.3 * e; roll = d * (0.18 - 0.4 * e); }
    else { const k = (t - 0.62) / 0.38; twist = -1.2 * d * (1 - k); spread = 1.25 * (1 - k); lean = 0.18 * (1 - k); roll = -0.22 * d * (1 - k); }
    m.armL.rotation.set(-0.35, 0, spread);
    m.armR.rotation.set(-0.35, 0, -spread);
    m.body.rotation.y = twist;
    m.body.rotation.x += lean;
    m.body.rotation.z = roll;
  } else { m.body.rotation.y = 0; m.body.rotation.z = 0; }
  if (s.spin) {
    m.armL.rotation.set(0.2, 0, 1.45); m.armR.rotation.set(0.2, 0, -1.45);
    m.legL.rotation.x = 0.3; m.legR.rotation.x = 0.3;
    m.body.rotation.x = 0.25;
  }
  m.cape.rotation.x = 0.15 + Math.min(1.2, s.speed * 0.04) + Math.sin(s.phase * 2.3) * 0.08;
  // in fast flight the blades swing back to trail along the arms; they snap forward to strike
  const trail = s.air && !(s.slash > 0) && !s.spin ? Math.min(1, (s.fly || 0) * 1.6) * 1.75 : 0;
  for (const g of m.grips) g.rotation.x += (trail - g.rotation.x) * Math.min(1, (trail > g.rotation.x ? 6 : 18) * (dt || 0.016));
}

// Faint blade copies left behind along the velocity: reads as motion blur at high speed.
const _w = new THREE.Vector3();
export function updateBladeBlur(m, vel) {
  const k = Math.min(1, Math.max(0, (vel.length() - 16) / 18));
  for (const gm of m.ghostMats) gm.opacity = gm.userData.base * k;
  for (const g of m.grips) g.userData.ghosts.forEach((gh, j) => {
    gh.visible = k > 0.02;
    if (!gh.visible) return;
    g.localToWorld(_w.copy(g.userData.bladePos)).addScaledVector(vel, -0.014 * (j + 1));
    gh.position.copy(g.worldToLocal(_w));
  });
}

// ---------------- Titan ----------------
const SKINS = ['#e3a98a', '#d69b7b', '#c98e6e', '#e8b896', '#b97f63', '#deb08f'];
const HAIRS = ['#2c1c12', '#5b3a22', '#1a1a1a', '#8a6a3a', null, null];

// opts: skin, hair (null = bald), hairLong, thin, bigHead, longArms, face, eye, armor, muscle, ribs,
//       fur, crystal, mask, claws, ears, saddle, quad, hunch
export function buildTitan(height, seed, opts = {}) {
  const r = mulberry32(seed);
  const px = height / 32;
  const skinHex = opts.skin || SKINS[Math.floor(r() * SKINS.length)];
  const hairHex = opts.hair !== undefined ? opts.hair : HAIRS[Math.floor(r() * HAIRS.length)];
  const lam = (hex, k = 1, extra = {}) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex).multiplyScalar(k), ...extra });
  const skin = lam(skinHex), skinDark = lam(skinHex, 0.8);
  const hairMat = hairHex ? lam(hairHex) : skin;
  const faceMat = new THREE.MeshLambertMaterial({ map: makeTitanFace(seed, skinHex, hairHex, opts.face || 'grin', opts.eye) });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 12 * px;
  root.add(body);
  const meshes = [];
  const add = (parent, geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    parent.add(m); meshes.push(m);
    return m;
  };

  const bw = opts.thin ? 7 : 8;
  add(body, box(bw * px, 12 * px, 4 * px), skin, 0, 6 * px, 0);
  add(body, box((bw + 0.3) * px, 2 * px, 4.3 * px), skinDark, 0, 1 * px, 0);
  if (opts.ribs || !opts.muscle) for (let i = 0; i < (opts.ribs ? 3 : 1); i++) add(body, box((bw - 2) * px, 0.8 * px, 4.2 * px), skinDark, 0, (8 - i * 1.6) * px, 0);
  if (opts.muscle) {
    const fib = lam(skinHex, 0.68);
    for (const x of [-2, 0.5, 2.5]) add(body, box(0.8 * px, 10 * px, 4.15 * px), fib, (x - 0.5) * px, 6.5 * px, 0);
  }

  const neck = new THREE.Group();
  neck.position.y = 12 * px;
  body.add(neck);
  const hs = opts.bigHead ? 10 : 8;
  // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back)
  const head = add(neck, box(hs * px, hs * px, hs * px), [skin, skin, hairMat, skin, faceMat, hairHex ? hairMat : skin], 0, (hs / 2) * px, 0);
  const nape = add(neck, box(3 * px, 2 * px, 1 * px), skinDark, 0, -0.5 * px, -2.3 * px);
  if (hairHex && opts.hairLong) add(neck, box((hs + 0.6) * px, hs * 1.15 * px, 1.6 * px), hairMat, 0, hs * 0.35 * px, -(hs / 2 + 0.5) * px);
  if (hairHex && opts.hairLong) for (const s of [1, -1]) add(neck, box(1 * px, hs * 0.9 * px, (hs * 0.7) * px), hairMat, s * (hs / 2 + 0.4) * px, hs * 0.5 * px, -hs * 0.12 * px);
  if (opts.ears) for (const s of [1, -1]) add(neck, box(1 * px, 2.5 * px, 1.5 * px), skinDark, s * (hs / 2 + 0.5) * px, hs * 0.55 * px, 0);
  if (opts.mask) add(neck, box((hs + 0.6) * px, 3.5 * px, 1.6 * px), lam('#ece4d0'), 0, 1.6 * px, (hs / 2 + 0.3) * px);

  const al = opts.longArms ? 16 : 12;
  const armL = limb(body, 4 * px, al * px, 4 * px, skin, (bw / 2 + 2) * px, 11.5 * px, 0);
  const armR = limb(body, 4 * px, al * px, 4 * px, skin, -(bw / 2 + 2) * px, 11.5 * px, 0);
  const legL = limb(root, 4 * px, 12 * px, 4 * px, skin, 2 * px, 12 * px, 0);
  const legR = limb(root, 4 * px, 12 * px, 4 * px, skin, -(2) * px, 12 * px, 0);
  for (const p of [armL, armR, legL, legR]) meshes.push(p.children[0]);
  armL.userData.len = armR.userData.len = al;

  if (opts.armor) {
    const plate = lam(opts.armor);
    add(body, box((bw + 0.8) * px, 6 * px, 5 * px), plate, 0, 8.5 * px, 0);
    add(neck, box((hs + 0.5) * px, 2.5 * px, (hs + 0.5) * px), plate, 0, (hs - 0.8) * px, 0);
    for (const a of [armL, armR]) { add(a, box(5 * px, 4 * px, 5 * px), plate, 0, -1 * px, 0); add(a, box(4.6 * px, 4 * px, 4.6 * px), plate, 0, -(al - 3) * px, 0); }
    for (const l of [legL, legR]) add(l, box(4.6 * px, 5 * px, 4.6 * px), plate, 0, -4 * px, 0.2 * px);
  }
  if (opts.fur) {
    for (const a of [armL, armR]) add(a, box(4.8 * px, (al * 0.6) * px, 4.8 * px), hairMat, 0, -(al * 0.35) * px, 0);
    add(body, box((bw + 1) * px, 9 * px, 1.6 * px), hairMat, 0, 7 * px, -2.4 * px);
    add(body, box((bw + 2) * px, 3 * px, 5 * px), hairMat, 0, 11 * px, 0);
  }
  if (opts.crystal) {
    const cr = new THREE.MeshLambertMaterial({ color: opts.crystal, emissive: new THREE.Color(opts.crystal).multiplyScalar(0.35) });
    for (const a of [armL, armR]) add(a, box(4.4 * px, 3 * px, 4.4 * px), cr, 0, -(al - 4) * px, 0);
    add(body, box(2 * px, 8 * px, 1 * px), cr, 0, 7 * px, 2.3 * px);
  }
  if (opts.claws) for (const a of [armL, armR]) for (const x of [-1.3, 0, 1.3]) add(a, box(0.7 * px, 3 * px, 0.7 * px), lam('#f4efe2'), x * px, -(al + 1.2) * px, 1.5 * px);
  if (opts.saddle) add(body, box(6 * px, 3 * px, 5 * px), lam('#5a3a22'), 0, 10 * px, -3 * px);

  const hardenMat = new THREE.MeshLambertMaterial({ color: 0x9fe8ff, emissive: 0x2a7fa0, transparent: true, opacity: 0.85 });
  const hardShell = new THREE.Mesh(box(4 * px, 3.5 * px, 1.6 * px), hardenMat);
  hardShell.position.set(0, -0.5 * px, -2.6 * px);
  hardShell.visible = false;
  neck.add(hardShell);

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, neck, head, armL, armR, legL, legR, meshes, px, height, napeMesh: nape, hardShell, skin, quad: !!opts.quad, hunch: opts.hunch || 0 };
}

// s: { phase, run, attack (0..1), attackArm, attackAngle, lean, kneel, blind, limpL, limpR }
export function animateTitan(m, s) {
  const sw = Math.sin(s.phase) * 0.55 * Math.min(1.2, s.run);
  m.legL.rotation.set(sw, 0, 0); m.legR.rotation.set(-sw, 0, 0);
  m.armL.rotation.set(-sw * 0.7, 0, 0.08); m.armR.rotation.set(sw * 0.7, 0, -0.08);
  m.body.rotation.set(0.08 * s.run + (s.lean || 0) + m.hunch, 0, 0);
  m.neck.rotation.set(-m.hunch * 0.8, Math.sin(s.phase * 0.5) * 0.15, 0);
  if (m.quad) {
    m.body.rotation.x = 1.25;
    m.neck.rotation.x = -1.15;
    m.armL.rotation.x = -1.25 - sw; m.armR.rotation.x = -1.25 + sw;
  }
  if (s.kneel) {
    m.legL.rotation.x = -1.45; m.legR.rotation.x = -1.45;
    m.body.rotation.x = 0.75;
    m.neck.rotation.x = -0.4;
  }
  if (s.blind > 0) {
    m.armL.rotation.set(-2.5, 0, -0.55); m.armR.rotation.set(-2.5, 0, 0.55);
    m.neck.rotation.x = 0.3;
  }
  if (s.attack > 0) {
    const a = s.attackArm === 'L' ? m.armL : m.armR;
    const k = s.attack < 0.6 ? s.attack / 0.6 : 1 - (s.attack - 0.6) / 0.4;
    const ang = s.attackAngle || 2.1;
    a.rotation.x = -ang * k;
    a.rotation.z = (s.attackArm === 'L' ? -0.35 : 0.35) * k;
    if (!m.quad && !s.kneel) m.body.rotation.x += (ang < 1.3 ? 0.4 : 0.15) * k;
  }
  if (s.limpL) m.armL.rotation.set(0.15, 0, 0.12);
  if (s.limpR) m.armR.rotation.set(0.15, 0, -0.12);
}
