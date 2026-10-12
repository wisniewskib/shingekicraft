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

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
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
      if (z >= WALLZ + 3) {
        const n = fbm(x / 38, z / 38, S, 4);
        const t = clamp((z - (WALLZ + 3)) / 16, 0, 1);
        h = Math.round(lerp(GROUND, GROUND + (n - 0.45) * 14, t));
        if (Math.abs(x - (GATE_X0 + GATE_X1) / 2) < 10 && z < WALLZ + 24) h = GROUND;
        h = clamp(h, 6, 18);
      }
      this.setRaw(x, 0, z, B.BEDROCK);
      for (let y = 1; y <= h; y++) {
        let id = B.STONE;
        if (y > h - 4) id = B.DIRT;
        if (y === h) id = B.GRASS;
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
    const supplySpots = [[44, WALLZ + 36], [150, WALLZ + 52], [96, D - 26], [GATE_X1 + 10, WALLZ - 10], [30, D - 20]];
    for (const [sx, sz] of supplySpots) {
      const g = this.heightMap[sx + sz * W];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) this.setRaw(sx + dx, g - 1, sz + dz, B.PATH);
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) this.setRaw(sx + dx, g, sz + dz, B.CRATE);
      this.setRaw(sx, g + 1, sz, B.CRATE);
      this.supplies.push({ x: sx + 1, y: g, z: sz + 1 });
    }

    // forest: giant trees + ruined pillars + small trees
    const taken = supplySpots.map(([x, z]) => ({ x, z, r: 10 }));
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

    this.buildDistrict(rng);
    this.gateTotal = this.countGate();
    this.pristine = this.blocks.slice();
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

  tower(x0, z0, rng) {
    const gy = GROUND + 1, h = 18 + Math.floor(rng() * 10);
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
