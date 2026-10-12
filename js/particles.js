// Two pools: opaque cubes (blood, debris) and soft billboards (steam, gas).
import * as THREE from 'three';
import { makePuffTexture } from './textures.js';

const MAX_CUBES = 1400, MAX_PUFFS = 900;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();

export class Particles {
  constructor(scene) {
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_CUBES);
    this.cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cubes.frustumCulled = false;
    this.cubes.count = 0;
    scene.add(this.cubes);
    this.c = [];

    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PUFFS * 3);
    this.pCol = new Float32Array(MAX_PUFFS * 4);
    this.pSize = new Float32Array(MAX_PUFFS);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makePuffTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
          vC.a *= smoothstep(0.8, 3.0, -mv.z); // don't blind the camera with puffs right in front of it
          gl_PointSize=size*scale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC.rgb, vC.a*t.a); if(gl_FragColor.a<0.01) discard; }`,
      transparent: true, depthWrite: false,
    });
    this.puffs = new THREE.Points(geo, mat);
    this.puffs.frustumCulled = false;
    scene.add(this.puffs);
    this.p = [];
    this.col = new THREE.Color();
  }

  cube(x, y, z, vx, vy, vz, color, size, life, grav = 22) {
    if (this.c.length >= MAX_CUBES) this.c.shift();
    this.c.push({ x, y, z, vx, vy, vz, color, size, life, max: life, grav, rx: Math.random() * 6, ry: Math.random() * 6 });
  }
  puff(x, y, z, vx, vy, vz, size, life, color = 0xffffff, alpha = 0.7, grow = 1.5, rise = 0) {
    if (this.p.length >= MAX_PUFFS) this.p.shift();
    this.col.set(color);
    this.p.push({ x, y, z, vx, vy, vz, size, life, max: life, r: this.col.r, g: this.col.g, b: this.col.b, a: alpha, grow, rise });
  }

  blood(x, y, z, n = 30, spread = 8) {
    for (let i = 0; i < n; i++) {
      this.cube(x, y, z, (Math.random() - 0.5) * spread, Math.random() * spread * 0.8, (Math.random() - 0.5) * spread,
        Math.random() < 0.5 ? 0xa01818 : 0xd02828, 0.12 + Math.random() * 0.2, 0.8 + Math.random() * 0.8);
    }
    for (let i = 0; i < n / 3; i++) this.puff(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 2.5, 1.2, 0xc02020, 0.55, 2);
  }
  steam(x, y, z, size = 4, n = 3) {
    for (let i = 0; i < n; i++)
      this.puff(x + (Math.random() - 0.5) * size, y + Math.random() * size * 0.5, z + (Math.random() - 0.5) * size,
        (Math.random() - 0.5) * 1.5, 2 + Math.random() * 3, (Math.random() - 0.5) * 1.5, size * 0.8, 2.5 + Math.random(), 0xffffff, 0.45, 2.2, 1.5);
  }
  debris(blocks, colors) {
    for (const b of blocks) {
      this.cube(b.x, b.y, b.z, (Math.random() - 0.5) * 10, Math.random() * 9, (Math.random() - 0.5) * 10, colors[b.id] || 0x888888, 0.3 + Math.random() * 0.4, 1.5 + Math.random());
      if (Math.random() < 0.3) this.puff(b.x, b.y, b.z, 0, 1, 0, 3, 1.4, 0xb8b0a0, 0.4, 2);
    }
  }

  update(dt) {
    let n = 0;
    for (let i = this.c.length - 1; i >= 0; i--) {
      const q = this.c[i];
      q.life -= dt;
      if (q.life <= 0) { this.c.splice(i, 1); continue; }
      q.vy -= q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rx += dt * 4; q.ry += dt * 3;
    }
    for (const q of this.c) {
      const s = q.size * Math.min(1, q.life / (q.max * 0.3));
      tmpP.set(q.x, q.y, q.z); tmpS.set(s, s, s); tmpQ.setFromEuler(tmpE.set(q.rx, q.ry, 0));
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.cubes.setMatrixAt(n, tmpM);
      this.cubes.setColorAt(n, this.col.set(q.color));
      n++;
    }
    this.cubes.count = n;
    this.cubes.instanceMatrix.needsUpdate = true;
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;

    let m = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const q = this.p[i];
      q.life -= dt;
      if (q.life <= 0) { this.p.splice(i, 1); continue; }
      q.vy += q.rise * dt;
      q.vx *= 1 - dt; q.vz *= 1 - dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (const q of this.p) {
      const t = 1 - q.life / q.max;
      this.pPos[m * 3] = q.x; this.pPos[m * 3 + 1] = q.y; this.pPos[m * 3 + 2] = q.z;
      this.pCol[m * 4] = q.r; this.pCol[m * 4 + 1] = q.g; this.pCol[m * 4 + 2] = q.b;
      this.pCol[m * 4 + 3] = q.a * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      this.pSize[m] = q.size * (1 + t * q.grow);
      m++;
    }
    const g = this.puffs.geometry;
    g.setDrawRange(0, m);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  clear() { this.c.length = 0; this.p.length = 0; }
}
