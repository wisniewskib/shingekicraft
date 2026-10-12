// Procedural 16x16 pixel textures: block atlas + titan faces. No image files.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export const ATLAS_COLS = 8, ATLAS_ROWS = 2, TILE = 16;

function shade(rng, r, g, b, j) {
  const k = 1 + (rng() - 0.5) * j;
  return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
}

function tile(ctx, index, fn, seed) {
  const ox = (index % ATLAS_COLS) * TILE, oy = Math.floor(index / ATLAS_COLS) * TILE;
  const rng = mulberry32(seed + index * 101);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    ctx.fillStyle = fn(x, y, rng);
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }
}

function pixelTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * TILE; c.height = ATLAS_ROWS * TILE;
  const ctx = c.getContext('2d');
  const S = 7;
  // 0 grass top
  tile(ctx, 0, (x, y, r) => shade(r, 92, 156, 52, 0.28), S);
  // 1 grass side
  const edge = Array.from({ length: 16 }, (_, i) => 3 + ((i * 7) % 3));
  tile(ctx, 1, (x, y, r) => (y < edge[x] ? shade(r, 92, 156, 52, 0.25) : shade(r, 134, 96, 67, 0.3)), S);
  // 2 dirt
  tile(ctx, 2, (x, y, r) => shade(r, 134, 96, 67, 0.32), S);
  // 3 stone
  tile(ctx, 3, (x, y, r) => (r() < 0.08 ? shade(r, 95, 95, 98, 0.1) : shade(r, 128, 128, 130, 0.18)), S);
  // 4 wall brick
  tile(ctx, 4, (x, y, r) => {
    const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 7) return shade(r, 92, 90, 86, 0.08);
    return shade(r, 158, 154, 146, 0.16);
  }, S);
  // 5 log side
  tile(ctx, 5, (x, y, r) => (x % 4 === 0 || r() < 0.06 ? shade(r, 72, 52, 30, 0.15) : shade(r, 104, 78, 46, 0.18)), S);
  // 6 log top (rings)
  tile(ctx, 6, (x, y, r) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7) return shade(r, 92, 68, 40, 0.15);
    return Math.floor(d) % 3 === 0 ? shade(r, 140, 108, 64, 0.1) : shade(r, 176, 140, 86, 0.1);
  }, S);
  // 7 leaves
  tile(ctx, 7, (x, y, r) => (r() < 0.18 ? shade(r, 30, 70, 26, 0.2) : shade(r, 54, 112, 40, 0.3)), S);
  // 8 planks
  tile(ctx, 8, (x, y, r) => (y % 4 === 3 || (y % 8 < 4 ? x === 5 : x === 12) ? shade(r, 110, 80, 46, 0.1) : shade(r, 168, 128, 76, 0.14)), S);
  // 9 roof shingles
  tile(ctx, 9, (x, y, r) => (y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 2) % 4 === 0 ? shade(r, 110, 34, 28, 0.1) : shade(r, 172, 58, 42, 0.16)), S);
  // 10 path gravel
  tile(ctx, 10, (x, y, r) => shade(r, 150, 140, 120, 0.3), S);
  // 11 plaster
  tile(ctx, 11, (x, y, r) => shade(r, 226, 216, 196, 0.07), S);
  // 12 dark stone
  tile(ctx, 12, (x, y, r) => shade(r, 70, 70, 76, 0.22), S);
  // 13 gate: dark wood + iron bands
  tile(ctx, 13, (x, y, r) => (y === 2 || y === 13 ? shade(r, 70, 72, 78, 0.12) : x % 5 === 4 ? shade(r, 52, 34, 20, 0.1) : shade(r, 92, 62, 36, 0.14)), S);
  // 14 supply crate
  tile(ctx, 14, (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15 ? shade(r, 90, 64, 36, 0.1) : (y > 6 && y < 9) ? shade(r, 90, 230, 255, 0.08) : shade(r, 170, 130, 78, 0.12)), S);
  // 15 sand
  tile(ctx, 15, (x, y, r) => shade(r, 214, 200, 150, 0.12), S);
  return pixelTexture(c);
}

// Titan head front. style: 'grin' (mindless), 'stern', 'teeth' (lipless), 'mask' (Jaw plate)
export function makeTitanFace(seed, skin, hair, style = 'grin', eye = null) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  const r = mulberry32(seed);
  const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, shadeHex(skin, 1 + (r() - 0.5) * 0.12));
  if (hair) for (let x = 0; x < 8; x++) { px(x, 0, hair); if (r() < 0.6) px(x, 1, hair); }
  const eyeY = 3;
  const iris = eye || '#1a1a1a';
  if (style === 'grin') {
    px(1, eyeY, '#f2f2f2'); px(2, eyeY, iris); px(5, eyeY, iris); px(6, eyeY, '#f2f2f2');
  } else {
    // shifters: heavy brow, glowing eyes
    for (let x = 1; x <= 6; x++) px(x, eyeY - 1, shadeHex(skin, 0.6));
    px(1, eyeY, '#101010'); px(2, eyeY, iris); px(5, eyeY, iris); px(6, eyeY, '#101010');
  }
  px(3, 4, shadeHex(skin, 0.82)); px(4, 4, shadeHex(skin, 0.82));
  if (style === 'grin') {
    const wide = r() < 0.5;
    for (let x = wide ? 0 : 1; x <= (wide ? 7 : 6); x++) px(x, 6, x % 2 ? '#f4efe2' : '#e8e0cc');
    px(wide ? 0 : 1, 5, '#5a1f1f'); px(wide ? 7 : 6, 5, '#5a1f1f');
    for (let x = 2; x <= 5; x++) px(x, 7, '#5a1f1f');
  } else if (style === 'teeth') {
    for (let x = 1; x <= 6; x++) { px(x, 5, '#f4efe2'); px(x, 6, x % 2 ? '#e8e0cc' : '#7a2a24'); }
    px(0, 5, '#7a2a24'); px(7, 5, '#7a2a24');
  } else if (style === 'mask') {
    for (let y = 4; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, y === 6 ? (x % 2 ? '#2a2a2a' : '#f8f4e8') : '#ece4d0');
  } else {
    for (let x = 2; x <= 5; x++) px(x, 6, shadeHex(skin, 0.55));
  }
  return pixelTexture(c);
}

export function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0, g = Math.min(255, ((n >> 8) & 255) * k) | 0, b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}

// Soft round sprite for steam / gas puffs.
export function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// Legion emblem: two crossed blades over a watchtower on a green shield (transparent background).
export function makeEmblemTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const shield = (inset, col) => {
    x.fillStyle = col;
    x.beginPath(); x.moveTo(3 + inset, 3 + inset); x.lineTo(29 - inset, 3 + inset); x.lineTo(29 - inset, 17); x.lineTo(16, 30 - inset * 1.4); x.lineTo(3 + inset, 17); x.closePath(); x.fill();
  };
  shield(0, '#c9a84a');
  shield(2, '#24502e');
  // watchtower
  x.fillStyle = '#d8d2c0';
  x.fillRect(13, 10, 6, 13);
  x.fillRect(12, 8, 2, 3); x.fillRect(15, 8, 2, 3); x.fillRect(18, 8, 2, 3);
  x.fillStyle = '#24502e'; x.fillRect(15, 14, 2, 3);
  // crossed blades
  x.lineWidth = 2; x.lineCap = 'square';
  x.strokeStyle = '#eef3f8';
  x.beginPath(); x.moveTo(7, 7); x.lineTo(24, 24); x.moveTo(25, 7); x.lineTo(8, 24); x.stroke();
  x.fillStyle = '#c9a84a'; x.fillRect(6, 23, 4, 2); x.fillRect(22, 23, 4, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soldier face: brows, eyes, nose shadow, mouth.
export function makeSoldierFace(skin = '#e8b48c', hair = '#2a1a10', eye = '#3a5a8a') {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  const px = (i, j, col) => { x.fillStyle = col; x.fillRect(i, j, 1, 1); };
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) px(i, j, skin);
  for (let i = 0; i < 8; i++) px(i, 0, hair);
  px(0, 1, hair); px(7, 1, hair); px(1, 1, hair); px(6, 1, hair);
  px(1, 2, shadeHex(hair, 1.2)); px(2, 2, shadeHex(hair, 1.2)); px(5, 2, shadeHex(hair, 1.2)); px(6, 2, shadeHex(hair, 1.2));
  px(1, 3, '#ffffff'); px(2, 3, eye); px(5, 3, eye); px(6, 3, '#ffffff');
  px(3, 4, shadeHex(skin, 0.85)); px(4, 4, shadeHex(skin, 0.85));
  px(3, 6, '#9a5a4a'); px(4, 6, '#9a5a4a');
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
