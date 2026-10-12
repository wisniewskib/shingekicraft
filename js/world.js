// Voxel world: generation (forest beyond the wall, the wall + gate, the district),
// chunked meshing with ambient occlusion, DDA raycasts and block destruction.
import * as THREE from 'three';
import { mulberry32, fbm, hash2, clamp, lerp } from './util.js';
import { ATLAS_COLS, ATLAS_ROWS } from './textures.js';

export const W = 192, D = 192, H = 84, CS = 16;
export const NCX = W / CS, NCZ = D / CS;
export const WALLZ = 64, WALL_TOP = 42, GROUND = 10;
export const GATE_X0 = 88, GATE_X1 = 103, GATE_Y0 = GROUND + 1, GATE_Y1 = GROUND + 20;

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, BRICK: 4, LOG: 5, LEAVES: 6, PLANKS: 7, ROOF: 8,
  PATH: 9, PLASTER: 10, DARK: 11, GATE: 12, CRATE: 13, SAND: 14, BEDROCK: 15,
};
// [top, side, bottom] atlas tiles per block id
const TILES = {
  1: [0, 1, 2], 2: [2, 2, 2], 3: [3, 3, 3], 4: [4, 4, 4], 5: [6, 5, 6], 6: [7, 7, 7], 7: [8, 8, 8], 8: [9, 9, 9],
  9: [10, 2, 2], 10: [11, 11, 11], 11: [12, 12, 12], 12: [13, 13, 13], 13: [14, 14, 14], 14: [15, 15, 15], 15: [12, 12, 12],
};
export const BLOCK_COLORS = {
  1: 0x5c9c34, 2: 0x866043, 3: 0x808082, 4: 0x9e9a92, 5: 0x684e2e, 6: 0x36702a, 7: 0xa8804c, 8: 0xac3a2a,
  9: 0x968c78, 10: 0xe2d8c4, 11: 0x46464c, 12: 0x5c3e24, 13: 0xaa824e, 14: 0xd6c896, 15: 0x46464c,
};

// Face table (winding verified for outward normals), from the classic three.js voxel layout.
const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.78, c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.88, c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.88, c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO = [0.42, 0.62, 0.8, 1.0];

// Playable maps. Every map keeps the wall + gate + inner district; the land beyond the wall changes.
export const MAPS = {
  forest: { name: 'Ostoja', desc: 'Las olbrzymich drzew i ruiny wież za murem.' },
  city: { name: 'Stare Miasto', desc: 'Gęsta, wysoka zabudowa za murem. Tytany burzą domy, przez które idą.', crush: true },
  canyon: { name: 'Wąwóz', desc: 'Kręta dolina między skalnymi ścianami, z łukami i mostami nad głową.' },
  trost: { name: 'Dzielnica Trost', desc: 'Brama wybita. Tytany wlewają się do miasta, a w środku stoi magazyn zaopatrzenia.', crush: true, breached: true },
  utgard: { name: 'Zamek Utgard', desc: 'Noc. Zrujnowany zamek na wzgórzu pośrodku równiny, tytany podchodzą pod mury.', look: 'night' },
};

const UTGARD = { x: 96, z: 136 };

export class World {
  constructor(seed = 1337, map = 'forest') {
    this.seed = seed;
    this.map = MAPS[map] ? map : 'forest';
    this.def = MAPS[this.map];
    this.blocks = new Uint8Array(W * H * D);
    this.heightMap = new Int16Array(W * D); // stand height of natural terrain (protected below)
    this.supplies = [];
    this.trees = [];
    this.meshes = new Array(NCX * NCZ).fill(null);
    this.dirty = new Set();
    this.material = null;
    this.group = new THREE.Group();
  }

  idx(x, y, z) { return x + z * W + y * W * D; }
  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return B.AIR;
    return this.blocks[x + z * W + y * W * D];
  }
  solid(x, y, z) { return this.get(Math.floor(x), Math.floor(y), Math.floor(z)) !== B.AIR; }
  setRaw(x, y, z, id) {
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0 || y >= H) return;
    this.blocks[x + z * W + y * W * D] = id;
  }
  set(x, y, z, id) {
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0 || y >= H) return;
    const i = x + z * W + y * W * D;
    if (this.blocks[i] === id) return;
    this.blocks[i] = id;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    this.dirty.add(cx + cz * NCX);
    const lx = x % CS, lz = z % CS;
    if (lx === 0 && cx > 0) this.dirty.add(cx - 1 + cz * NCX);
    if (lx === CS - 1 && cx < NCX - 1) this.dirty.add(cx + 1 + cz * NCX);
    if (lz === 0 && cz > 0) this.dirty.add(cx + (cz - 1) * NCX);
    if (lz === CS - 1 && cz < NCZ - 1) this.dirty.add(cx + (cz + 1) * NCX);
  }
  groundY(x, z) {
    const xi = clamp(Math.floor(x), 0, W - 1), zi = clamp(Math.floor(z), 0, D - 1);
    return this.heightMap[xi + zi * W];
  }
  topY(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    for (let y = H - 1; y >= 0; y--) if (this.get(xi, y, zi) !== B.AIR) return y + 1;
    return 0;
  }

  // ---------- generation ----------
  generate() {
    const rng = mulberry32(this.seed);
    const S = this.seed;
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      let h = GROUND;
      if (z >= WALLZ + 3 && this.map === 'forest') {
        const n = fbm(x / 38, z / 38, S, 4);
        const t = clamp((z - (WALLZ + 3)) / 16, 0, 1);
        h = Math.round(lerp(GROUND, GROUND + (n - 0.45) * 14, t));
        if (Math.abs(x - (GATE_X0 + GATE_X1) / 2) < 10 && z < WALLZ + 24) h = GROUND;
        h = clamp(h, 6, 18);
      } else if (z >= WALLZ + 3 && this.map === 'utgard') {
        const t = clamp((z - (WALLZ + 3)) / 16, 0, 1);
        const hill = Math.max(0, 9 - Math.hypot(x - UTGARD.x, z - UTGARD.z) * 0.32);
        h = Math.round(GROUND + (fbm(x / 50, z / 50, S, 3) - 0.5) * 6 * t + hill);
        h = clamp(h, 7, 22);
      } else if (z >= WALLZ + 3 && this.map === 'canyon') {
        // a winding valley floor between steep rock walls
        const cx = this.valleyX(z), hw = this.valleyHalf(z);
        const out = Math.abs(x - cx) - hw;
        const t = clamp((z - (WALLZ + 6)) / 18, 0, 1);
        const cliff = out > 0 ? Math.min(52, out * 2.4 + fbm(x / 9, z / 9, S, 3) * 10) : fbm(x / 20, z / 20, S + 3, 2) * 2;
        h = clamp(Math.round(GROUND + cliff * t), 8, H - 12);
      }
      this.setRaw(x, 0, z, B.BEDROCK);
      for (let y = 1; y <= h; y++) {
        let id = B.STONE;
        const rocky = this.map === 'canyon' && h > GROUND + 6;
        if (y > h - 4 && !rocky) id = B.DIRT;
        if (y === h) id = rocky ? (h > GROUND + 30 ? B.GRASS : B.STONE) : B.GRASS;
        if (rocky && y < h && (y % 7 === 0) && hash2(x, z + y, S) < 0.5) id = B.DARK; // strata
        if ((this.map === 'city' || this.map === 'trost') && z >= WALLZ + 3 && y === h) id = B.PATH;
        this.setRaw(x, y, z, id);
      }
      this.heightMap[x + z * W] = h + 1;
    }

    // district streets
    for (let z = 0; z < WALLZ; z++) for (let x = 0; x < W; x++) {
      const avenue = x >= GATE_X0 - 2 && x <= GATE_X1 + 2;
      const cross = z % 24 < 4 || (z > WALLZ - 8);
      if (avenue || cross) this.setRaw(x, GROUND, z, B.PATH);
    }
    // path out of the gate into the forest
    for (let z = WALLZ + 3; z < WALLZ + 20; z++) for (let x = GATE_X0 + 3; x <= GATE_X1 - 3; x++) this.setRaw(x, GROUND, z, B.PATH);

    this.buildWall();

    // supply stations
    const supplySpots = this.map === 'canyon'
      ? [[this.valleyX(WALLZ + 36), WALLZ + 36], [this.valleyX(WALLZ + 80), WALLZ + 80], [this.valleyX(D - 26), D - 26], [GATE_X1 + 10, WALLZ - 10]]
      : [[44, WALLZ + 36], [150, WALLZ + 52], [96, D - 26], [GATE_X1 + 10, WALLZ - 10], [30, D - 20]];
    for (const [sx0, sz] of supplySpots) {
      const sx = Math.round(sx0);
      const g = this.heightMap[sx + sz * W];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) this.setRaw(sx + dx, g - 1, sz + dz, B.PATH);
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) this.setRaw(sx + dx, g, sz + dz, B.CRATE);
      this.setRaw(sx, g + 1, sz, B.CRATE);
      this.supplies.push({ x: sx + 1, y: g, z: sz + 1 });
    }
    const taken = supplySpots.map(([x, z]) => ({ x, z, r: 10 }));
    if (this.map === 'forest') this.buildForest(rng, taken);
    else if (this.map === 'city') this.buildOuterCity(rng, taken);
    else if (this.map === 'trost') this.buildTrost(rng, taken);
    else if (this.map === 'utgard') this.buildUtgard(rng, taken);
    else this.buildCanyon(rng, taken);

    this.buildDistrict(rng);
    this.gateTotal = this.countGate();
    this.pristine = this.blocks.slice();
  }

  valleyX(z) { return W / 2 + 8 + Math.sin(z * 0.035) * 26 + Math.sin(z * 0.011 + 1) * 10; }
  valleyHalf(z) { return 19 + Math.sin(z * 0.07) * 4 + (z < WALLZ + 20 ? 20 : 0); }

  // A random spot outside the wall where titans can stand (the valley floor on the canyon map).
  randomOutside(rng = Math.random, minZ = WALLZ + 25) {
    for (let a = 0; a < 40; a++) {
      const x = 12 + Math.floor(rng() * (W - 24)), z = minZ + Math.floor(rng() * (D - 8 - minZ));
      if (this.heightMap[x + z * W] <= GROUND + 4) return { x: x + 0.5, z: z + 0.5 };
    }
    return { x: this.valleyX(minZ + 20), z: minZ + 20 };
  }

  buildForest(rng, taken) {
    const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    for (let i = 0; i < 9; i++) {
      for (let a = 0; a < 60; a++) {
        const x = 10 + Math.floor(rng() * (W - 20)), z = WALLZ + 14 + Math.floor(rng() * (D - WALLZ - 22));
        if (!free(x, z, 9)) continue;
        this.pillar(x, z, rng);
        taken.push({ x, z, r: 6 });
        break;
      }
    }
    for (let i = 0; i < 30; i++) {
      for (let a = 0; a < 80; a++) {
        const x = 8 + Math.floor(rng() * (W - 16)), z = WALLZ + 10 + Math.floor(rng() * (D - WALLZ - 16));
        if (!free(x, z, 8)) continue;
        this.giantTree(x, z, rng);
        taken.push({ x, z, r: 7 });
        this.trees.push({ x, z });
        break;
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = 4 + Math.floor(rng() * (W - 8)), z = WALLZ + 6 + Math.floor(rng() * (D - WALLZ - 10));
      if (free(x, z, 3)) { this.smallTree(x, z, rng); taken.push({ x, z, r: 2 }); }
    }
  }

  // Outer town: a street grid of tall houses, towers, a cathedral and small parks.
  buildOuterCity(rng, taken) {
    const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    const z0 = WALLZ + 22;
    // main avenue from the gate and a cathedral on the central square
    this.cathedral(GATE_X0 - 2, WALLZ + 92, rng);
    taken.push({ x: GATE_X0 + 8, z: WALLZ + 100, r: 24 });
    for (let lx = 4; lx < W - 14; lx += 15) for (let lz = z0; lz < D - 14; lz += 15) {
      if (lx + 14 > GATE_X0 - 4 && lx < GATE_X1 + 5 && lz < WALLZ + 70) continue; // keep the gate avenue open
      const x = lx + Math.floor(rng() * 2), z = lz + Math.floor(rng() * 2);
      if (!free(x + 5, z + 5, 6)) continue;
      const r = rng();
      if (r < 0.1) { for (let k = 0; k < 3; k++) this.smallTree(x + 2 + Math.floor(rng() * 8), z + 2 + Math.floor(rng() * 8), rng); }
      else if (r < 0.28) this.tower(x + 3, z + 3, rng, 26 + Math.floor(rng() * 14));
      else this.house(x, z, 8 + Math.floor(rng() * 4), 7 + Math.floor(rng() * 4), 8 + Math.floor(rng() * 9));
    }
  }

  cathedral(x0, z0, rng) {
    const gy = GROUND + 1, w = 20, d = 30, h = 22;
    for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
      this.setRaw(x, GROUND, z, B.PLANKS);
      for (let y = gy; y < gy + h; y++) {
        const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
        if (!edge) continue;
        const win = (y - gy) % 7 > 2 && (y - gy) % 7 < 6 && (x + z) % 4 === 0;
        if (z === z0 && Math.abs(x - (x0 + w / 2)) < 2 && y < gy + 6) continue; // door
        if (!win) this.setRaw(x, y, z, B.STONE);
      }
    }
    for (let i = 0; ; i++) {
      const xa = x0 - 1 + i, xb = x0 + w - i;
      if (xa > xb) break;
      for (let z = z0 - 1; z <= z0 + d; z++) { this.setRaw(xa, gy + h + i, z, B.ROOF); this.setRaw(xb, gy + h + i, z, B.ROOF); }
    }
    // bell tower with a spire
    const tx = x0 + w / 2 - 3, tz = z0 - 6;
    for (let x = tx; x < tx + 7; x++) for (let z = tz; z < tz + 7; z++) for (let y = gy; y < gy + 40; y++) {
      const edge = x === tx || x === tx + 6 || z === tz || z === tz + 6;
      if (edge && !((y - gy) % 9 > 5 && (x === tx + 3 || z === tz + 3))) this.setRaw(x, y, z, B.STONE);
    }
    for (let i = 0; i < 8; i++) for (let x = tx - 1 + i; x <= tx + 7 - i; x++) for (let z = tz - 1 + i; z <= tz + 7 - i; z++) this.setRaw(x, gy + 40 + i * 2, z, B.ROOF), this.setRaw(x, gy + 41 + i * 2, z, B.ROOF);
  }

  // Trost: the gate is already smashed open and the town runs right up to it.
  // A big supply depot stands in the middle of the outer town.
  buildTrost(rng, taken) {
    const depot = { x: GATE_X0 - 8, z: WALLZ + 70 };
    this.depot(depot.x, depot.z);
    taken.push({ x: depot.x + 14, z: depot.z + 10, r: 22 });
    const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    for (let lx = 4; lx < W - 12; lx += 13) for (let lz = WALLZ + 14; lz < D - 12; lz += 13) {
      if (lx + 12 > GATE_X0 - 3 && lx < GATE_X1 + 4 && lz < WALLZ + 40) continue;
      const x = lx + Math.floor(rng() * 2), z = lz + Math.floor(rng() * 2);
      if (!free(x + 5, z + 5, 5)) continue;
      const r = rng();
      if (r < 0.14) this.tower(x + 3, z + 3, rng, 22 + Math.floor(rng() * 12));
      else this.house(x, z, 7 + Math.floor(rng() * 4), 7 + Math.floor(rng() * 3), 6 + Math.floor(rng() * 8));
    }
    // the breach: gate gone, rubble scattered in front of it
    for (let x = GATE_X0; x <= GATE_X1; x++) for (let z = WALLZ; z <= WALLZ + 2; z++) for (let y = GATE_Y0; y <= GATE_Y1; y++) this.setRaw(x, y, z, B.AIR);
    for (let i = 0; i < 40; i++) {
      const x = GATE_X0 - 6 + Math.floor(rng() * 28), z = WALLZ - 10 + Math.floor(rng() * 24);
      if (z >= WALLZ && z <= WALLZ + 2 && x >= GATE_X0 && x <= GATE_X1) continue;
      const g = this.heightMap[x + z * W];
      this.setRaw(x, g, z, rng() < 0.5 ? B.GATE : B.BRICK);
      if (rng() < 0.4) this.setRaw(x, g + 1, z, B.BRICK);
    }
  }

  depot(x0, z0) {
    const gy = GROUND + 1, w = 28, d = 20, h = 14;
    for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
      this.setRaw(x, GROUND, z, B.PLANKS);
      for (let y = gy; y < gy + h; y++) {
        const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
        if (!edge) continue;
        if (z === z0 && x > x0 + 10 && x < x0 + 18 && y < gy + 8) continue; // big doors
        if ((y - gy) % 5 === 3 && (x + z) % 3 === 0) continue;
        this.setRaw(x, y, z, (x + y) % 9 === 0 ? B.LOG : B.STONE);
      }
    }
    for (let i = 0; ; i++) {
      const za = z0 - 1 + i, zb = z0 + d - i;
      if (za > zb) break;
      for (let x = x0 - 1; x <= x0 + w; x++) { this.setRaw(x, gy + h + i, za, B.ROOF); this.setRaw(x, gy + h + i, zb, B.ROOF); }
    }
    // crates stacked inside
    for (let k = 0; k < 10; k++) for (let y = 0; y < 2; y++) this.setRaw(x0 + 3 + k * 2, gy + y, z0 + d - 4, B.CRATE);
  }

  // Utgard: a ruined castle on a hill in open country.
  buildUtgard(rng, taken) {
    const S = this.seed, cx = UTGARD.x, cz = UTGARD.z, half = 18;
    const base = (x, z) => this.heightMap[x + z * W] - 1;
    const ruin = (x, y, z) => hash2(x * 3 + y, z * 5 - y, S) < 0.12 && y > 6;
    // curtain walls
    for (let x = cx - half; x <= cx + half; x++) for (let z = cz - half; z <= cz + half; z++) {
      const edge = x === cx - half || x === cx + half || z === cz - half || z === cz + half;
      const edge2 = x === cx - half + 1 || x === cx + half - 1 || z === cz - half + 1 || z === cz + half - 1;
      if (!edge && !edge2) continue;
      const g = base(x, z), top = 16;
      for (let y = 1; y <= top; y++) if (!ruin(x, y, z)) this.setRaw(x, g + y, z, B.BRICK);
      if (edge && (x + z) % 2 === 0) this.setRaw(x, g + top + 1, z, B.BRICK);
    }
    // gateway facing the wall
    for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - half; z <= cz - half + 1; z++) for (let y = 1; y <= 9; y++) this.setRaw(x, base(x, z) + y, z, B.AIR);
    // corner towers
    for (const [tx, tz] of [[cx - half, cz - half], [cx + half, cz - half], [cx - half, cz + half], [cx + half, cz + half]]) {
      const g = base(tx, tz), top = 26 + Math.floor(rng() * 6);
      for (let y = 0; y <= top; y++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz > 10) continue;
        const shell = dx * dx + dz * dz >= 5;
        if (shell && !ruin(tx + dx, y, tz + dz)) this.setRaw(tx + dx, g + y, tz + dz, B.BRICK);
      }
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (dx * dx + dz * dz <= 10 && (dx + dz) % 2 === 0) this.setRaw(tx + dx, g + top + 1, tz + dz, B.BRICK);
    }
    // the keep
    const kg = base(cx, cz), kh = 40;
    for (let y = 0; y < kh; y++) for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const shell = Math.abs(dx) === 5 || Math.abs(dz) === 5;
      const floor = y % 10 === 0;
      if (!shell && !floor) continue;
      if (shell && (y % 10 > 3 && y % 10 < 7) && (dx === 0 || dz === 0)) continue; // windows
      if (shell && ruin(cx + dx, y, cz + dz) && y > kh - 12) continue;
      this.setRaw(cx + dx, kg + y, cz + dz, shell ? B.STONE : B.PLANKS);
    }
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) if ((Math.abs(dx) === 6 || Math.abs(dz) === 6) && (dx + dz) % 2 === 0) this.setRaw(cx + dx, kg + kh, cz + dz, B.STONE);
    taken.push({ x: cx, z: cz, r: half + 6 });
    // a few lone trees and boulders on the plain
    for (let i = 0; i < 26; i++) {
      const x = 6 + Math.floor(rng() * (W - 12)), z = WALLZ + 12 + Math.floor(rng() * (D - WALLZ - 16));
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 3)) continue;
      if (rng() < 0.7) this.smallTree(x, z, rng);
      else { const g = this.heightMap[x + z * W]; for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) this.setRaw(x + dx, g, z + dz, B.STONE); }
    }
    for (let i = 0; i < 5; i++) {
      for (let a = 0; a < 40; a++) {
        const x = 10 + Math.floor(rng() * (W - 20)), z = WALLZ + 20 + Math.floor(rng() * (D - WALLZ - 28));
        if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 8)) continue;
        this.giantTree(x, z, rng); taken.push({ x, z, r: 7 }); break;
      }
    }
  }

  // Canyon: rock spires and stone arches over the valley, plank bridges, pines on the rim.
  buildCanyon(rng, taken) {
    const S = this.seed;
    for (const za of [WALLZ + 42, WALLZ + 86, WALLZ + 118]) {
      const cx = this.valleyX(za), hw = this.valleyHalf(za) + 4, top = GROUND + 30 + Math.floor(rng() * 8);
      for (let x = Math.floor(cx - hw - 3); x <= cx + hw + 3; x++) {
        const k = (x - cx) / (hw + 3);
        const yTop = top - Math.round(k * k * 7);
        for (let z = za; z < za + 4; z++) for (let y = yTop - 3; y <= yTop; y++) this.setRaw(x, y, z, hash2(x, y + z, S) < 0.2 ? B.DARK : B.STONE);
      }
    }
    for (const zb of [WALLZ + 62, WALLZ + 102]) {
      const cx = this.valleyX(zb), hw = this.valleyHalf(zb) + 6, y = GROUND + 18;
      for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
        const sag = Math.round(Math.cos(((x - cx) / hw) * Math.PI / 2) * 2);
        for (let z = zb; z < zb + 3; z++) this.setRaw(x, y - sag, z, B.PLANKS);
        if ((x - Math.floor(cx - hw)) % 6 === 0) { this.setRaw(x, y - sag + 1, zb - 1, B.LOG); this.setRaw(x, y - sag + 1, zb + 3, B.LOG); }
      }
    }
    for (let i = 0; i < 10; i++) {
      const z = WALLZ + 24 + Math.floor(rng() * (D - WALLZ - 34));
      const x = Math.round(this.valleyX(z) + (rng() - 0.5) * this.valleyHalf(z) * 1.2);
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 6)) continue;
      const h = 20 + Math.floor(rng() * 20), r = 1.6 + rng() * 1.6, g = this.heightMap[x + z * W];
      for (let y = 0; y < h; y++) {
        const rr = r * (1 - (y / h) * 0.55) + (hash2(x + y, z, S) - 0.5) * 0.8;
        const R = Math.ceil(rr);
        for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dz * dz <= rr * rr) this.setRaw(x + dx, g - 1 + y, z + dz, y % 6 === 0 ? B.DARK : B.STONE);
      }
      taken.push({ x, z, r: 5 });
    }
    for (let i = 0; i < 70; i++) {
      const x = 4 + Math.floor(rng() * (W - 8)), z = WALLZ + 14 + Math.floor(rng() * (D - WALLZ - 18));
      const hm = this.heightMap[x + z * W];
      if (hm > GROUND + 20 || (hm <= GROUND + 2 && rng() < 0.15)) this.smallTree(x, z, rng);
    }
  }

  reset() {
    this.blocks.set(this.pristine);
    for (let i = 0; i < NCX * NCZ; i++) this.dirty.add(i);
    this.rebuildDirty(Infinity);
  }

  buildWall() {
    for (let x = 0; x < W; x++) for (let z = WALLZ; z <= WALLZ + 2; z++) {
      for (let y = 1; y <= WALL_TOP; y++) this.setRaw(x, y, z, B.BRICK);
      if ((z === WALLZ || z === WALLZ + 2) && x % 2 === 0) this.setRaw(x, WALL_TOP + 1, z, B.BRICK);
    }
    for (let x = GATE_X0; x <= GATE_X1; x++) for (let z = WALLZ; z <= WALLZ + 2; z++) {
      for (let y = GATE_Y0; y <= GATE_Y1; y++) this.setRaw(x, y, z, B.GATE);
      this.setRaw(x, GATE_Y1 + 1, z, B.DARK);
    }
    for (let y = GATE_Y0; y <= GATE_Y1 + 1; y++) for (let z = WALLZ - 1; z <= WALLZ + 3; z++) {
      this.setRaw(GATE_X0 - 1, y, z, B.DARK); this.setRaw(GATE_X1 + 1, y, z, B.DARK);
    }
    for (const tx of [16, 56, 136, 176]) {
      for (let x = tx - 3; x <= tx + 3; x++) for (let z = WALLZ - 2; z <= WALLZ + 4; z++) {
        for (let y = 1; y <= WALL_TOP + 8; y++) this.setRaw(x, y, z, B.BRICK);
        const edge = x === tx - 3 || x === tx + 3 || z === WALLZ - 2 || z === WALLZ + 4;
        if (edge && (x + z) % 2 === 0) this.setRaw(x, WALL_TOP + 9, z, B.BRICK);
      }
    }
  }

  pillar(cx, cz, rng) {
    const g = this.heightMap[cx + cz * W];
    const h = 22 + Math.floor(rng() * 16);
    for (let y = g - 1; y < g + h; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (y > g + h - 4 && rng() < 0.25) continue;
      this.setRaw(cx + dx, y, cz + dz, rng() < 0.15 ? B.STONE : B.BRICK);
    }
    const top = g + h;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      this.setRaw(cx + dx, top, cz + dz, B.DARK);
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (edge && (dx + dz) % 2 === 0) this.setRaw(cx + dx, top + 1, cz + dz, B.BRICK);
    }
  }

  leafBlob(cx, cy, cz, rx, ry, rng) {
    const S = this.seed;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
        for (let dz = -Math.ceil(rx); dz <= Math.ceil(rx); dz++) {
          const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rx * rx);
          if (e > 1) continue;
          const x = cx + dx, y = cy + dy, z = cz + dz;
          if (e > 0.6 && hash2(x * 7 + y, z * 3 - y, S) < 0.4) continue;
          if (this.get(x, y, z) === B.AIR) this.setRaw(x, y, z, B.LEAVES);
        }
  }

  giantTree(cx, cz, rng) {
    const g = this.heightMap[cx + cz * W];
    const r = 1.6 + rng() * 1.1;
    const th = 30 + Math.floor(rng() * 24);
    for (let y = 0; y < th; y++) {
      const rr = r + (y < 3 ? (3 - y) * 0.7 : 0);
      const R = Math.ceil(rr);
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++)
        if (dx * dx + dz * dz <= rr * rr) this.setRaw(cx + dx, g - 1 + y, cz + dz, B.LOG);
    }
    const nb = 2 + Math.floor(rng() * 3);
    for (let b = 0; b < nb; b++) {
      const by = g + Math.floor(th * (0.45 + rng() * 0.35));
      const ang = rng() * Math.PI * 2, len = 5 + rng() * 6;
      let ex = cx, ey = by, ez = cz;
      for (let s = 0; s <= len; s += 0.5) {
        ex = Math.round(cx + Math.cos(ang) * s); ez = Math.round(cz + Math.sin(ang) * s); ey = Math.round(by + s * 0.4);
        this.setRaw(ex, ey, ez, B.LOG);
      }
      this.leafBlob(ex, ey + 1, ez, 3 + rng() * 1.5, 2.2, rng);
    }
    this.leafBlob(cx, g + th, cz, 6 + rng() * 4, 3.5 + rng() * 2.5, rng);
  }

  smallTree(cx, cz, rng) {
    const g = this.heightMap[cx + cz * W];
    const h = 4 + Math.floor(rng() * 3);
    for (let y = 0; y < h; y++) this.setRaw(cx, g + y, cz, B.LOG);
    this.leafBlob(cx, g + h, cz, 2.5, 2, rng);
  }

  buildDistrict(rng) {
    for (let lx = 3; lx < W - 12; lx += 15) for (let lz = 5; lz < WALLZ - 14; lz += 24) {
      for (const off of [0, 12]) {
        const x0 = lx + Math.floor(rng() * 3), z0 = lz + off;
        if (x0 + 12 > GATE_X0 - 3 && x0 < GATE_X1 + 4) continue;
        if (z0 + 8 > WALLZ - 8) continue;
        const r = rng();
        if (r < 0.08) continue;
        if (r < 0.18) this.tower(x0 + 2, z0 + 2, rng);
        else this.house(x0, z0, 7 + Math.floor(rng() * 4), 6 + Math.floor(rng() * 3), 5 + Math.floor(rng() * 5));
      }
    }
    // gatehouse plaza towers
    this.tower(GATE_X0 - 9, WALLZ - 12, rng);
    this.tower(GATE_X1 + 4, WALLZ - 22, rng);
  }

  house(x0, z0, w, d, h) {
    const gy = GROUND + 1, x1 = x0 + w - 1, z1 = z0 + d - 1;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      this.setRaw(x, GROUND, z, B.PLANKS);
      for (let y = gy; y < gy + h; y++) {
        const ex = x === x0 || x === x1, ez = z === z0 || z === z1;
        if (!ex && !ez) continue;
        const corner = ex && ez;
        const win = !corner && (y === gy + 2 || (h > 6 && y === gy + 5)) && (x + z) % 3 === 0;
        const door = z === z0 && x === x0 + (w >> 1) && y < gy + 2;
        if (win || door) continue;
        this.setRaw(x, y, z, corner || y === gy + h - 1 ? B.LOG : B.PLASTER);
      }
    }
    for (let i = 0; ; i++) {
      const za = z0 - 1 + i, zb = z1 + 1 - i;
      if (za > zb) break;
      const y = gy + h + i;
      for (let x = x0 - 1; x <= x1 + 1; x++) { this.setRaw(x, y, za, B.ROOF); this.setRaw(x, y, zb, B.ROOF); }
      for (let z = za + 1; z < zb; z++) { this.setRaw(x0, y, z, B.PLASTER); this.setRaw(x1, y, z, B.PLASTER); }
    }
  }

  tower(x0, z0, rng, height) {
    const gy = GROUND + 1, h = height || 18 + Math.floor(rng() * 10);
    for (let x = x0; x < x0 + 5; x++) for (let z = z0; z < z0 + 5; z++)
      for (let y = gy; y < gy + h; y++) {
        const edge = x === x0 || x === x0 + 4 || z === z0 || z === z0 + 4;
        if (!edge) continue;
        if ((y - gy) % 6 === 3 && (x === x0 + 2 || z === z0 + 2)) continue;
        this.setRaw(x, y, z, B.STONE);
      }
    for (let i = 0; i < 4; i++) for (let x = x0 - 1 + i; x <= x0 + 5 - i; x++) for (let z = z0 - 1 + i; z <= z0 + 5 - i; z++)
      this.setRaw(x, gy + h + i, z, B.ROOF);
  }

  // Only the lower, titan-reachable part of the gate counts toward a breach.
  countGate() {
    let n = 0;
    for (let x = GATE_X0; x <= GATE_X1; x++) for (let z = WALLZ; z <= WALLZ + 2; z++)
      for (let y = GATE_Y0; y <= GATE_Y0 + 13; y++) if (this.get(x, y, z) === B.GATE) n++;
    return n;
  }

  // ---------- meshing ----------
  initMeshes(scene, atlas) {
    this.material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
    scene.add(this.group);
    for (let i = 0; i < NCX * NCZ; i++) this.dirty.add(i);
    this.rebuildDirty(Infinity);
  }

  rebuildDirty(max = 6) {
    let n = 0;
    for (const id of this.dirty) {
      this.dirty.delete(id);
      this.buildChunk(id % NCX, Math.floor(id / NCX));
      if (++n >= max) break;
    }
  }

  buildChunk(cx, cz) {
    const pos = [], uv = [], col = [], ind = [];
    const x0 = cx * CS, z0 = cz * CS;
    const g = (x, y, z) => this.get(x, y, z) !== B.AIR ? 1 : 0;
    for (let y = 0; y < H; y++) for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
      const id = this.blocks[x + z * W + y * W * D];
      if (!id) continue;
      const tiles = TILES[id];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], [dx, dy, dz] = F.dir;
        if (this.get(x + dx, y + dy, z + dz) !== B.AIR) continue;
        if (y === 0 && dy < 0) continue;
        const t = dy > 0 ? tiles[0] : dy < 0 ? tiles[2] : tiles[1];
        const tx = t % ATLAS_COLS, ty = Math.floor(t / ATLAS_COLS);
        const ndx = pos.length / 3;
        const ax = dx !== 0 ? 0 : dy !== 0 ? 1 : 2; // normal axis
        for (const c of F.c) {
          pos.push(x + c[0], y + c[1], z + c[2]);
          uv.push((tx + 0.002 + c[3] * 0.996) / ATLAS_COLS, 1 - (ty + 1 - (0.002 + c[4] * 0.996)) / ATLAS_ROWS);
          // ambient occlusion from the 3 neighbours around this corner, in the layer in front of the face
          const bx = x + dx, by = y + dy, bz = z + dz;
          const o = [c[0] ? 1 : -1, c[1] ? 1 : -1, c[2] ? 1 : -1];
          const t1 = ax === 0 ? 1 : 0, t2 = ax === 2 ? 1 : 2;
          const s1 = [0, 0, 0], s2 = [0, 0, 0];
          s1[t1] = o[t1]; s2[t2] = o[t2];
          const a = g(bx + s1[0], by + s1[1], bz + s1[2]);
          const b = g(bx + s2[0], by + s2[1], bz + s2[2]);
          const cc = g(bx + s1[0] + s2[0], by + s1[1] + s2[1], bz + s1[2] + s2[2]);
          const ao = a && b ? 0 : 3 - (a + b + cc);
          const k = AO[ao] * F.shade;
          col.push(k, k, k);
        }
        ind.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
      }
    }
    const i = cx + cz * NCX;
    let mesh = this.meshes[i];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(ind);
    geo.computeBoundingSphere();
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
    else { mesh = new THREE.Mesh(geo, this.material); mesh.matrixAutoUpdate = false; this.group.add(mesh); this.meshes[i] = mesh; }
  }

  // ---------- queries ----------
  raycast(ox, oy, oz, dx, dy, dz, maxD) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxD) {
      const id = this.get(x, y, z);
      if (id !== B.AIR) return { t, x, y, z, id, nx, ny, nz, px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (y < -1 || y > H + 40) break;
    }
    return null;
  }

  // Destroy blocks in a sphere; terrain below the natural ground and bedrock survive.
  destroySphere(cx, cy, cz, r, out = null, { protectWall = true, skip = null } = {}) {
    let n = 0;
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
      if (x < 0 || z < 0 || x >= W || z >= D || y < 1 || y >= H) continue;
      if (y < this.heightMap[x + z * W] - 1) continue;
      const id = this.get(x, y, z);
      if (!id || id === B.BEDROCK || (skip && skip.has(id))) continue;
      if (protectWall && id === B.BRICK && z >= WALLZ - 2 && z <= WALLZ + 4) continue;
      this.set(x, y, z, B.AIR);
      n++;
      if (out && out.length < 60 && Math.random() < 0.5) out.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, id });
    }
    return n;
  }
}

// Axis-separated AABB vs voxel movement with sub-stepping and 1-block step-up.
export function collides(world, p, hw, h) {
  const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + h - 0.001);
  const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
  if (x0 < 0 || z0 < 0 || x1 >= W || z1 >= D) return true;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
    if (world.get(x, y, z) !== B.AIR) return true;
  return false;
}

export function moveAABB(world, p, v, dt, hw, h, canStep) {
  const res = { ground: false, hitX: false, hitZ: false, hitY: false, impact: 0 };
  const maxV = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  const steps = Math.max(1, Math.ceil((maxV * dt) / 0.35));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    // Y
    p.y += v.y * sdt;
    if (collides(world, p, hw, h)) {
      if (v.y < 0) { p.y = Math.floor(p.y) + 1; res.ground = true; }
      else p.y = Math.floor(p.y + h) - h - 0.001;
      res.impact = Math.max(res.impact, Math.abs(v.y));
      v.y = 0; res.hitY = true;
    }
    for (const ax of ['x', 'z']) {
      const d = v[ax] * sdt;
      if (!d) continue;
      p[ax] += d;
      if (collides(world, p, hw, h)) {
        if (canStep && res.ground !== false) {
          p.y += 1.01;
          if (!collides(world, p, hw, h)) continue;
          p.y -= 1.01;
        }
        if (v[ax] > 0) p[ax] = Math.floor(p[ax] + hw) - hw - 0.001;
        else p[ax] = Math.floor(p[ax] - hw) + 1 + hw + 0.001;
        if (collides(world, p, hw, h)) p[ax] -= d; // safety
        res.impact = Math.max(res.impact, Math.abs(v[ax]));
        v[ax] = 0;
        if (ax === 'x') res.hitX = true; else res.hitZ = true;
      }
    }
  }
  if (!res.ground) {
    p.y -= 0.05;
    res.ground = collides(world, p, hw, h);
    p.y += 0.05;
  }
  return res;
}
