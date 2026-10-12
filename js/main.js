// Shingekicraft — game loop, camera, missions, scoring, HUD, menus, settings.
import * as THREE from 'three';
import { World, W, D, H, WALLZ, GATE_X0, GATE_X1, BLOCK_COLORS } from './world.js';
import { makeAtlas } from './textures.js';
import { Particles } from './particles.js';
import { Soldier, HOOK_RANGE } from './soldier.js';
import { Titan } from './titans.js';
import { PlayerTitan, Scout } from './titanplayer.js';
import { TITAN_TYPES, RANDOM_TITAN } from './titantypes.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { clamp, rand, fmtTime, store, damp } from './util.js';
import { NetSession } from './net/session.js';
import { T, vec } from './net/protocol.js';
import { NET } from './net/config.js';

const $ = (s) => document.querySelector(s);
const GATE_CX = (GATE_X0 + GATE_X1) / 2 + 0.5;

const QUALITY = {
  high: { label: 'Wysoka', pr: 1.5, far: 260, aa: true },
  medium: { label: 'Średnia', pr: 1, far: 200, aa: false },
  low: { label: 'Niska', pr: 0.7, far: 140, aa: false },
};

const MISSIONS = [
  { id: 'm1', name: 'Pierwsza wyprawa', side: 'soldier', desc: 'Wyjedź za bramę i zetnij 5 tytanów.', tag: 'MISJA 1 · ZA MUREM',
    quote: 'Pierwszy raz za murem? Trzymaj się drzew, lina to twoje życie. Tniesz tylko kark, od tyłu.',
    bullets: ['Zabij 5 tytanów', 'Uzupełniaj gaz przy niebieskich promieniach', 'H pokazuje sterowanie'],
    goal: { kills: 5 }, titans: { max: 4, abnormal: 0, h: [4, 10] } },
  { id: 'm2', name: 'Obrona bramy', side: 'soldier', desc: 'Tytany walą w bramę. Zabij 12, zanim padnie dzielnica.', tag: 'MISJA 2 · OBLĘŻENIE',
    quote: 'Brama długo nie wytrzyma. Każdy tytan pod murem to rysa w dzielnicy. Podetnij im nogi.',
    bullets: ['Zabij 12 tytanów', 'Pilnuj paska dzielnicy', 'Dwie przecięte nogi = tytan na kolanach'],
    goal: { kills: 12 }, titanGoal: 'gate', district: true, titans: { max: 6, abnormal: 0.1, h: [6, 15], far: true } },
  { id: 'm3', name: 'Polowanie na odmieńców', side: 'soldier', desc: 'Odmieńcy grasują w lesie. Zabij 4 w 5 minut.', tag: 'MISJA 3 · POLOWANIE',
    quote: 'Odmieńcy nie grają według zasad. Skaczą, biegają, nie odpuszczają. Najpierw oczy, potem kark.',
    bullets: ['Zabij 4 odmieńców', 'Masz 5 minut', 'Cięcie w oczy oślepia'],
    goal: { abnormals: 4 }, time: 300, titans: { max: 6, abnormal: 0.45, h: [5, 14] } },
  { id: 'm4', name: 'Burzyciel muru', side: 'titan', desc: 'Grasz tytanem. Rozbij bramę, zanim zwiadowcy zetną ci kark.', tag: 'MISJA 4 · DRUGA STRONA',
    quote: 'Tym razem to ty jesteś potworem. Zwiadowcy celują w kark. Nie daj im wylądować.',
    bullets: ['Rozbij bramę albo przez nią przejdź', 'Każdy atak strąca zwiadowców z karku', 'Masz 5 minut'],
    goal: { gate: 0.3 }, time: 300, scouts: true },
  { id: 'm5', name: 'Ostatni bastion', side: 'soldier', desc: 'Z lasu wylewają się kolejne fale. Przetrwaj 4 minuty.', tag: 'MISJA 5 · FALA',
    quote: 'Las się rusza. Z każdą minutą będzie ich więcej. Utrzymaj się przy życiu, żołnierzu.',
    bullets: ['Przetrwaj 4 minuty', 'Fale rosną z czasem', 'Gaz i ostrza przy niebieskich promieniach'],
    goal: { survive: 240 }, titans: { max: 7, abnormal: 0.25, h: [5, 15], ramp: true } },
];
const FREE = {
  soldier: { id: 'free-s', name: 'Wolna gra', side: 'soldier', free: true, tag: 'PIASKOWNICA · TYTANY BEZ KOŃCA',
    quote: 'Żadnych rozkazów, żadnego zegara. Tytany krążą po lesie. Ćwicz bujanie i pościgi.',
    bullets: ['Tytany wciąż nadchodzą', 'Gaz i ostrza przy niebieskich promieniach', 'H pokazuje sterowanie'],
    titans: { max: 8, abnormal: 0.2, h: [4, 15] } },
  titan: { id: 'free-t', name: 'Wolna gra', side: 'titan', free: true, scouts: true, tag: 'PIASKOWNICA · TRYB TYTANA',
    quote: 'Rób, co chcesz. Burz, depcz, zbijaj zwiadowców. Tylko pilnuj karku.',
    bullets: ['Zwiadowcy wciąż nadlatują', 'Mur i dzielnica są do zniszczenia', 'Q / E / F to twoje moce'] },
};

const SOLDIER_KEYS = [
  ['LPM / PPM', 'lewa / prawa lina (trzymaj)'], ['Spacja', 'ciąg gazu · skok'], ['Shift', 'mocne zwijanie liny'],
  ['G / C', 'dopalacze lądowania (hamulec)'], ['WASD', 'bieg · sterowanie · W rozbuja'], ['E', 'cięcie (3× = combo)'],
  ['Trzymaj E', 'pchnięcie na kark'], ['Q', 'młynek (wirujące cięcie)'], ['F', 'unik · uwolnienie z chwytu'], ['R', 'zmiana ostrzy'],
  ['M', 'muzyka: pełna · pół · off'], ['V', 'kamera 1. / 3. osoba'], ['H', 'ukryj tę pomoc'], ['Esc', 'pauza · ustawienia'],
];

const SETTINGS_DEFAULT = { sens: 1, vol: 0.8, music: 1, view: 200, invert: false, fp: false };

// ---------------- HUD ----------------
class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('#hud');
    this.q = (id) => document.getElementById(id);
    this.cache = new Map();
    this.pts = [];
    this.radioAt = -99;
  }
  text(id, v) { if (this.cache.get(id) !== v) { this.cache.set(id, v); this.q(id).textContent = v; } }
  bar(id, v) {
    const w = Math.round(clamp(v, 0, 100));
    if (this.cache.get(id) !== w) { this.cache.set(id, w); this.q(id).style.width = w + '%'; }
  }
  cls(id, c, on) { const k = id + '.' + c; if (this.cache.get(k) !== on) { this.cache.set(k, on); this.q(id).classList.toggle(c, on); } }
  vis(id, on) { const k = id + '.vis'; if (this.cache.get(k) !== on) { this.cache.set(k, on); this.q(id).style.display = on ? 'block' : 'none'; } }
  show(on) { this.el.classList.toggle('hidden', !on); }

  setMode(side, mission, ttype) {
    this.cache.clear();
    const titan = side === 'titan';
    this.q('gasWrap').classList.toggle('hidden', titan);
    this.q('bladeWrap').classList.toggle('hidden', titan);
    this.q('abilities').classList.toggle('hidden', !titan);
    this.q('hookDist').textContent = '';
    this.q('crosshair').className = '';
    this.q('hkL').style.display = this.q('hkR').style.display = titan ? 'none' : '';
    this.q('hpLabel').textContent = titan ? 'KARK' : 'ZDROWIE';
    this.q('missionName').textContent = mission.name;
    this.q('missionSub').textContent = titan ? ttype.name : mission.desc || 'Tytany nigdy nie przestają przychodzić';
    this.q('districtWrap').classList.toggle('hidden', !(mission.district || titan));
    this.q('districtLabel').textContent = titan ? 'BRAMA' : 'DZIELNICA';
    this.q('objWrap').classList.toggle('hidden', !!mission.free);
    this.q('objective').classList.toggle('hidden', !!mission.free);
    this.q('warning').style.display = 'none';
    this.q('feed').innerHTML = '';
    this.q('chain').classList.remove('on');
    this.q('radio').classList.add('off');
    let keys;
    if (titan) {
      const ab = ttype.abilities;
      const slots = [['LPM', ttype.lmb || 'Atak', 'lmb'], ['PPM', 'Chwyt', 'rmb']];
      for (const k of ['Q', 'E', 'F']) if (ab[k]) slots.push([k, ab[k].name, k]);
      this.q('abilities').innerHTML = slots.map(([k, n, id]) => `<div class="ab" data-k="${id}"><b>${k}</b><span>${n}</span><i></i></div>`).join('');
      keys = [...slots.map(([k, n]) => [k, n.toLowerCase()]), ['Spacja', 'skok'], ['Shift', 'bieg'], ['WASD', 'ruch'], ['M', 'muzyka'], ['H', 'ukryj tę pomoc'], ['Esc', 'pauza · ustawienia']];
    } else {
      this.q('abilities').innerHTML = '';
      keys = SOLDIER_KEYS;
    }
    this.q('keys').innerHTML = `<div class="kgrid">${keys.map(([k, d]) => `<b>${k}</b><span>${d}</span>`).join('')}</div>`;
    document.querySelectorAll('#touch [data-t]').forEach((b) => {
      const [s, t] = b.dataset.t.split('|');
      let label = titan ? t : s;
      if (titan && /^[QEF]$/.test(t)) label = ttype.abilities[t] ? ttype.abilities[t].name : '-';
      b.textContent = label;
      b.style.display = label === '-' ? 'none' : '';
    });
    for (const p of this.pts) p.el.remove();
    this.pts = [];
    this.toggleKeys(true);
  }
  toggleKeys(force) { this.q('keys').classList.toggle('on', force); }
  banner(title, sub) {
    const b = this.q('banner');
    this.q('bannerTitle').textContent = title;
    this.q('bannerSub').textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  // Captain on the radio. Unimportant lines don't interrupt each other.
  radio(msg, important = false) {
    const now = this.game.time;
    if (!important && now - this.radioAt < 9) return;
    this.radioAt = now;
    this.q('radioMsg').textContent = msg;
    const r = this.q('radio');
    r.classList.remove('off');
    clearTimeout(this.radioT);
    this.radioT = setTimeout(() => r.classList.add('off'), 7000);
    audio.play('ui', 0.6);
  }
  popup(title, tags, score) {
    const p = this.q('popup');
    this.q('popTitle').textContent = title;
    this.q('popTags').textContent = tags;
    this.q('popScore').textContent = score;
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
  }
  toast(t) {
    const e = this.q('toast');
    e.textContent = t;
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  }
  combo(n) {
    const e = this.q('comboTxt');
    e.textContent = n === 3 ? 'WIR!' : n > 1 ? `COMBO ×${n}` : '';
    e.classList.remove('show'); void e.offsetWidth; if (n > 1) e.classList.add('show');
  }
  feed(t) {
    const f = this.q('feed'), d = document.createElement('div');
    d.textContent = t; f.prepend(d);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => d.remove(), 4000);
  }
  chain(n) {
    const c = this.q('chain');
    if (n > 1) { c.textContent = `ŁAŃCUCH ×${n}`; c.classList.add('on'); } else c.classList.remove('on');
  }
  flash(id = 'flash') {
    const f = this.q(id);
    f.style.transition = 'none'; f.style.opacity = 1;
    setTimeout(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; }, 30);
  }
  points(worldPos, amount) {
    const v = worldPos.clone().project(this.game.camera);
    const x = v.z < 1 ? ((v.x + 1) / 2) * innerWidth : innerWidth / 2, y = v.z < 1 ? ((1 - v.y) / 2) * innerHeight : innerHeight / 2;
    const el = document.createElement('div');
    el.className = 'pt';
    el.textContent = `+${amount.toLocaleString()}`;
    this.q('points').appendChild(el);
    this.pts.push({ el, x, y, t: 0, amount });
  }
  updatePoints(dt) {
    if (!this.pts.length) return;
    const box = this.q('scoreVal').getBoundingClientRect();
    const tx = box.left + box.width / 2, ty = box.top + box.height / 2;
    for (const p of this.pts) {
      p.t += dt;
      let x = p.x, y = p.y - Math.min(0.5, p.t) * 60, s = 1;
      if (p.t > 0.6) { const k = Math.min(1, (p.t - 0.6) / 0.45), e = k * k; x = x + (tx - x) * e; y = y + (ty - y) * e; s = 1 - 0.5 * e; }
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      if (p.t >= 1.05) { p.el.remove(); p.done = true; this.game.bankScore(p.amount); }
    }
    this.pts = this.pts.filter((p) => !p.done);
  }
}

// ---------------- Game ----------------
class Game {
  constructor() {
    this.canvas = $('#game');
    this.multiplayer = false; // slow-motion and hit-stop only make sense in solo play
    this.settings = { ...SETTINGS_DEFAULT, ...(store('settings') || {}) };
    this.qualityKey = store('quality') || 'medium';
    if (!QUALITY[this.qualityKey]) this.qualityKey = 'medium';
    const Q = QUALITY[this.qualityKey];
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: Q.aa, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa8d0f5);
    this.scene.fog = new THREE.Fog(0xb9dbf7, 80, 260);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 300);
    this.scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x5c6b3c, 1.25));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.set(60, 120, 30);
    this.scene.add(sun);
    this.buildSky();

    this.world = new World(1337);
    this.world.generate();
    this.world.initMeshes(this.scene, makeAtlas());
    this.buildSupplyBeams();
    this.buildMinimap();
    this.particles = new Particles(this.scene);
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'play' && !this.input.touch) this.pause(); };
    this.canvas.addEventListener('click', () => { if (this.state === 'play' && !this.input.locked) this.input.lock(); });
    if (matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window) this.input.setupTouch($('#touch'));
    addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); $('#fps').classList.toggle('hidden'); } });

    this.hud = new HUD(this);
    this.soldier = new Soldier(this);
    this.titanPlayer = new PlayerTitan(this);
    this.titanPlayer.setType(TITAN_TYPES[0]);
    this.titanType = null;
    this.soldier.m.root.visible = false;
    this.titanPlayer.m.root.visible = false;
    this.player = null;
    this.titans = []; this.scouts = []; this.chunks = [];
    this.camYaw = Math.PI; this.camPitch = 0.1;
    this.camDir = new THREE.Vector3(0, 0, 1);
    this.camDistActual = 4.8;
    this.camTarget = new THREE.Vector3();
    this.camRoll = 0; this.fovKick = 0;
    this.shakeAmt = 0;
    this.time = 0; this.slowT = 0; this.hitStop = 0;
    this.said = {}; this.chains = {}; this.myKills = 0;
    this.net = null; // NetSession while playing online
    this.ray = new THREE.Raycaster();
    this.speedCtx = $('#speedlines').getContext('2d');
    this.fpsFrames = 0; this.fpsT = 0; this.fps = 60;

    this.applyQuality();
    this.bindMenus();
    this.bindMultiplayer();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.toMenu();
    const room = new URLSearchParams(location.search).get('room');
    if (room) { $('#mpCode').value = room; this.showScreen('mp'); }
    this.last = performance.now();
    $('#loading').classList.add('hidden');
    requestAnimationFrame((t) => this.loop(t));
  }

  applyQuality() {
    const Q = QUALITY[this.qualityKey];
    this.maxPR = Math.min(devicePixelRatio || 1, Q.pr);
    this.pr = this.maxPR;
    this.drsStuck = false; this.drsPrev = null;
    this.renderer.setPixelRatio(this.pr);
    $('#qualityBtn').firstChild.nodeValue = `Grafika: ${Q.label}`;
    this.applySettings();
    this.resize();
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = 0.0022 * s.sens;
    audio.setVolumes(s.vol, s.music);
    this.scene.fog.near = s.view * 0.35;
    this.scene.fog.far = s.view;
    this.camera.far = s.view + 20;
    this.camera.updateProjectionMatrix();
    store('settings', s);
  }

  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h=clamp(vP.y,0.0,1.0); vec3 top=vec3(0.28,0.55,0.92); vec3 hor=vec3(0.73,0.86,0.97); gl_FragColor=vec4(mix(hor,top,pow(h,0.6)),1.0); }',
    }));
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false });
    const cells = [];
    for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) {
      const n = Math.sin(x * 0.37) * Math.cos(z * 0.29) + Math.sin(x * 0.11 + z * 0.17) * 0.8;
      if (n > 0.85) cells.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach(([x, z], i) => { m4.makeScale(12, 4, 12).setPosition(x * 12, 0, z * 12); inst.setMatrixAt(i, m4); });
    inst.position.set(W / 2, 105, D / 2);
    this.clouds = inst;
    this.scene.add(inst);
  }

  buildSupplyBeams() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x6ff3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.CylinderGeometry(0.7, 0.7, 90, 8, 1, true);
    for (const s of this.world.supplies) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y + 45, s.z);
      this.scene.add(m);
    }
  }

  // Top-down picture of the world (north = +z = up), drawn once.
  buildMinimap() {
    const c = document.createElement('canvas');
    c.width = W; c.height = D;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      let y = H - 1, id = 0;
      for (; y >= 0; y--) { id = this.world.get(x, y, z); if (id) break; }
      const col = BLOCK_COLORS[id] || 0x333333;
      const k = 0.65 + Math.min(0.55, y / 60);
      const o = ((D - 1 - z) * W + x) * 4;
      img.data[o] = Math.min(255, ((col >> 16) & 255) * k);
      img.data[o + 1] = Math.min(255, ((col >> 8) & 255) * k);
      img.data[o + 2] = Math.min(255, (col & 255) * k);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapImg = c;
    this.mapCtx = $('#minimap').getContext('2d');
  }

  drawMinimap() {
    const ctx = this.mapCtx, S = 300, R = 70, k = S / (2 * R);
    const P = this.player.pos;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1e2a18'; ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapImg, P.x - R, D - 1 - P.z - R, 2 * R, 2 * R, 0, 0, S, S);
    const to = (x, z) => [S / 2 + (x - P.x) * k, S / 2 - (z - P.z) * k];
    const dot = (x, z, r, col) => { const [a, b] = to(x, z); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a, b, r, 0, Math.PI * 2); ctx.fill(); };
    for (const s of this.world.supplies) dot(s.x, s.z, 6, '#6ff3ff');
    for (const t of this.titans) if (!t.dead) dot(t.pos.x, t.pos.z, 4 + t.height * 0.35, t.ally ? '#7ad06a' : t.abnormal ? '#ff9a3a' : '#e0453a');
    for (const s of this.scouts) if (!s.dead) dot(s.pos.x, s.pos.z, 5, s.threatening ? '#ff5a46' : '#ffffff');
    // player arrow, pointing where the camera looks
    const [cx, cy] = to(P.x, P.z);
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(-Math.sin(this.camYaw), Math.cos(this.camYaw)) + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------- multiplayer screens ----------
  missionByKey(k) { return k === 'free-s' ? FREE.soldier : MISSIONS.find((m) => m.id === k && m.side === 'soldier') || FREE.soldier; }

  bindMultiplayer() {
    const nameIn = $('#mpName');
    nameIn.value = store('name') || '';
    const status = (t) => { $('#mpStatus').textContent = t; };
    const name = () => { const n = nameIn.value.trim() || 'Zwiadowca'; store('name', n); return n; };
    const busy = (on) => { $('#mpCreate').disabled = $('#mpJoin').disabled = on; };
    $('#mpCreate').onclick = async () => {
      audio.init(); busy(true); status('Tworzę pokój…');
      try { this.net = new NetSession(this); await this.net.host(name()); status(''); this.showLobby(); }
      catch (e) { this.dropNet(); status('Nie udało się utworzyć pokoju: ' + (e.message || e.type || e)); }
      busy(false);
    };
    $('#mpJoin').onclick = async () => {
      audio.init();
      const code = $('#mpCode').value.trim();
      if (!code) return status('Wpisz kod pokoju.');
      busy(true); status('Łączę z pokojem…');
      try { this.net = new NetSession(this); await this.net.join(code, name()); status(''); if (this.net.phase === 'lobby') this.showLobby(); }
      catch (e) { this.dropNet(); status(e.message || 'Nie udało się połączyć.'); }
      busy(false);
    };
    $('#mpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mpJoin').click(); });
    const sel = $('#lobbyMission');
    sel.innerHTML = [['free-s', 'Wolna gra · bez końca'], ['m1', 'Pierwsza wyprawa'], ['m2', 'Obrona bramy'], ['m3', 'Polowanie na odmieńców'], ['m5', 'Ostatni bastion']]
      .map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    sel.onchange = () => { if (this.net && this.net.isHost) this.net.setMission(sel.value); };
    $('#lobbyStart').onclick = () => { if (this.net && this.net.isHost) { audio.play('ui'); this.net.start(sel.value); } };
    $('#lobbyLeave').onclick = () => { this.dropNet(); this.toMenu(); this.showScreen('mp'); };
    $('#copyLink').onclick = () => {
      const url = `${location.origin}${location.pathname}?room=${this.net.code}`;
      const done = () => { $('#copyLink').textContent = 'Skopiowano!'; setTimeout(() => ($('#copyLink').textContent = 'Kopiuj link'), 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Link do pokoju:', url));
      else prompt('Link do pokoju:', url);
    };
    const lobbySend = () => { const v = $('#lobbyChatIn').value.trim(); if (v && this.net) this.net.chat(v); $('#lobbyChatIn').value = ''; };
    $('#lobbyChatSend').onclick = lobbySend;
    $('#lobbyChatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') lobbySend(); });
    // in-game chat: Enter opens it, Enter sends, Esc cancels
    addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.net && this.state === 'play' && !this.chatOpen) { e.preventDefault(); this.openChat(); }
    });
    $('#chatIn').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v && this.net) this.net.chat(v); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    });
  }

  openChat() {
    this.chatOpen = true;
    for (const c of [...this.input.down]) this.input.release(c);
    this.input.suspended = true;
    const el = $('#chatIn');
    el.value = ''; el.style.display = 'block'; el.focus();
  }
  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.input.suspended = false;
    const el = $('#chatIn');
    el.blur(); el.style.display = 'none';
  }

  showLobby() {
    this.state = 'lobby';
    this.clearActors();
    this.hud.show(false);
    this.input.unlock();
    this.soldier.m.root.visible = false;
    this.showScreen('lobby');
    this.onLobby();
  }

  // Lobby list / host controls; also brings everyone back from a finished match.
  onLobby() {
    const n = this.net;
    if (!n) return;
    if (n.phase === 'lobby' && this.state !== 'lobby' && this.state !== 'menu') { this.showLobby(); return; }
    $('#lobbyCode').textContent = n.code || '-----';
    const CAP = ['#2f6b3a', '#3a4f7a', '#7a2f2f', '#6a4a8a', '#2f6b6b', '#8a6a2a', '#4a4a4a', '#7a3a5a'];
    $('#lobbyPlayers').innerHTML = [...n.players.values()].sort((a, b) => a.index - b.index)
      .map((p) => `<div><i style="background:${CAP[p.index % CAP.length]}"></i>${p.name.replace(/</g, '&lt;')}${p.id === n.selfId ? ' (ty)' : ''}<small>${p.id === 'host' ? 'HOST' : ''}</small></div>`).join('');
    const sel = $('#lobbyMission');
    sel.value = n.missionKey;
    sel.disabled = !n.isHost;
    $('#lobbyStart').style.display = n.isHost ? '' : 'none';
    $('#lobbyWait').style.display = n.isHost ? 'none' : '';
    this.renderBoard();
  }

  onNetStart(key) {
    this.campaign = false;
    this.startMission(this.missionByKey(key));
  }
  onNetEnd(m) {
    this.applyBoard(m.board);
    this.end(m.win, m.reason);
  }
  onHostLost(msg) {
    if (!this.net) return;
    this.dropNet();
    this.toMenu();
    this.showScreen('mp');
    $('#mpStatus').textContent = msg;
  }
  dropNet() {
    const n = this.net;
    this.net = null;
    this.multiplayer = false;
    if (n) n.leave();
    for (const t of this.titans) if (t.puppet) t.remove = true;
    $('#board').classList.remove('on');
    this.closeChat();
  }

  onChat(name, msg) {
    const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
    const html = name ? `<b>${esc(name)}:</b> ${esc(msg)}` : `<em>${esc(msg)}</em>`;
    for (const id of ['lobbyChat', 'chatFeed']) {
      const box = $('#' + id), d = document.createElement('div');
      d.innerHTML = html; box.appendChild(d);
      while (box.children.length > (id === 'chatFeed' ? 6 : 60)) box.firstChild.remove();
      box.scrollTop = box.scrollHeight;
    }
  }

  renderBoard() {
    const n = this.net;
    if (!n) return;
    const rows = [...n.players.values()].sort((a, b) => b.score - a.score)
      .map((p, i) => `<div class="${p.id === n.selfId ? 'me' : ''}"><span>${i + 1}</span><span>${p.name.replace(/</g, '&lt;')}</span><span>${p.kills}</span><span>${p.score.toLocaleString()}</span></div>`);
    $('#boardList').innerHTML = `<div class="head"><span>#</span><span>GRACZ</span><span>ZAB.</span><span>PUNKTY</span></div>` + rows.join('');
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const sc = $('#speedlines');
    sc.width = w; sc.height = h;
  }

  // ---------- menus ----------
  bindMenus() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      audio.init(); audio.play('ui');
      const go = b.dataset.go;
      if (go === 'menu') this.toMenu();
      else if (go === 'campaign') {
        const p = store('campaign') || 0;
        this.campaign = true;
        this.requestMission(MISSIONS[p >= MISSIONS.length ? 0 : p]);
      } else this.showScreen(go);
    }));
    document.querySelectorAll('[data-free]').forEach((b) => b.addEventListener('click', () => {
      audio.init(); this.campaign = false; this.requestMission(FREE[b.dataset.free]);
    }));
    $('#qualityBtn').onclick = () => {
      const keys = Object.keys(QUALITY);
      this.qualityKey = keys[(keys.indexOf(this.qualityKey) + 1) % keys.length];
      store('quality', this.qualityKey);
      this.settings.view = QUALITY[this.qualityKey].far;
      $('#setView').value = this.settings.view;
      this.applyQuality();
      audio.init(); audio.play('ui');
    };
    $('#briefGo').onclick = () => { audio.init(); audio.play('ui'); this.startMission(this.pendingMission); };
    $('#resumeBtn').onclick = () => this.resume();
    $('#restartBtn').onclick = () => { if (this.net) { if (this.net.isHost) this.net.start(this.net.missionKey); } else this.startMission(this.mission); };
    $('#retryBtn').onclick = () => { if (this.net) { if (this.net.isHost) this.net.start(this.net.missionKey); } else this.startMission(this.mission); };
    $('#nextBtn').onclick = () => {
      if (this.net) { if (this.net.isHost) this.net.toLobby(); return; }
      const i = MISSIONS.indexOf(this.mission);
      if (i >= 0 && i < MISSIONS.length - 1) this.requestMission(MISSIONS[i + 1]);
    };
    // settings (pause screen)
    const bind = (id, key) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!this.settings[key]; else el.value = this.settings[key];
      el.addEventListener('input', () => { this.settings[key] = el.type === 'checkbox' ? el.checked : parseFloat(el.value); this.applySettings(); });
    };
    bind('#setSens', 'sens'); bind('#setVol', 'vol'); bind('#setMusic', 'music');
    bind('#setView', 'view'); bind('#setInvert', 'invert'); bind('#setFp', 'fp');

    const list = $('#missionList');
    MISSIONS.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      const best = store('best_' + m.id);
      b.innerHTML = `${i + 1}. ${m.name}<small>${m.desc}${best ? ` · Rekord ${best.toLocaleString()}` : ''}${m.side === 'titan' ? ' · Grasz tytanem' : ''}</small>`;
      b.onclick = () => { audio.init(); this.campaign = false; this.requestMission(m); };
      list.appendChild(b);
    });
    const grid = $('#titanGrid');
    for (const t of [RANDOM_TITAN, ...TITAN_TYPES]) {
      const b = document.createElement('button');
      b.className = 'tcard';
      const pw = Object.entries(t.abilities).map(([k, a]) => `<span><b>${k}</b>${a.name}</span>`).join('');
      b.innerHTML = `<div class="tname">${t.name}</div><div class="tmeta">${t.random ? '7–15 m' : t.h + ' m'}${t.armor ? ` · pancerz ${Math.round(t.armor * 100)}%` : ''}</div><div class="tdesc">${t.desc}</div><div class="tpow">${pw}</div>`;
      b.onclick = () => { audio.init(); audio.play('ui'); this.titanType = t; this.showBriefing(this.pendingMission); };
      grid.appendChild(b);
    }
  }

  // Titan missions go through the titan picker, every mission through a briefing.
  requestMission(m) {
    this.pendingMission = m;
    if (m.side === 'titan') this.showScreen('titans');
    else this.showBriefing(m);
  }

  showBriefing(m) {
    this.pendingMission = m;
    $('#briefImg').src = 'img/briefing.webp';
    $('#briefTag').textContent = m.tag || '';
    $('#briefTitle').textContent = m.name + (m.side === 'titan' && this.titanType ? ` · ${this.titanType.name}` : '');
    $('#briefQuote').textContent = m.quote || m.desc;
    $('#briefList').innerHTML = (m.bullets || []).map((b) => `<li>${b}</li>`).join('');
    this.showScreen('briefing');
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  }

  toMenu() {
    if (this.net) this.dropNet();
    this.multiplayer = false;
    this.state = 'menu';
    this.input.unlock();
    this.hud.show(false);
    $('#touch').classList.remove('play');
    this.showScreen('menu');
    const p = store('campaign') || 0;
    $('#campaignSub').textContent = p > 0 && p < MISSIONS.length ? `Kontynuuj: misja ${p + 1} z ${MISSIONS.length}` : `${MISSIONS.length} misji`;
    this.clearActors();
    if (this.world.dirtyFlag) { this.world.reset(); this.world.dirtyFlag = false; }
    this.player = null; this.mission = null;
    this.soldier.reset();
    this.soldier.m.root.visible = false;
    this.titanPlayer.reset();
    this.titanPlayer.m.root.visible = false;
    for (let i = 0; i < 6; i++) this.spawnTitan({ h: [5, 15], abnormal: 0.15 }, true);
    this.menuA = 0;
    audio.setGas(0); audio.setWind(0);
    if (audio.ctx) { audio.intensity = 0; audio.startMusic(); }
  }

  clearActors() {
    for (const t of this.titans) t.dispose();
    for (const s of this.scouts) s.dispose();
    for (const c of this.chunks) this.scene.remove(c.mesh);
    this.titans = []; this.scouts = []; this.chunks = [];
    this.particles.clear();
  }

  // ---------- missions ----------
  startMission(m) {
    this.mission = m;
    this.showScreen(null);
    this.clearActors();
    if (this.world.dirtyFlag) { this.world.reset(); this.world.dirtyFlag = false; }
    this.elapsed = 0; this.score = 0; this.shownScore = 0; this.kills = 0; this.abnormalKills = 0;
    this.chainN = 0; this.bestChain = 0; this.lastKill = -99; this.chainEnd = 0;
    this.district = 100; this.spawnT = 0; this.deathAt = null; this.gateCheckT = 0; this.gatePct = 100; this.gateBroken = false;
    this.hitStop = 0; this.slowT = 0; this.fovKick = 0;
    this.said = {}; this.chains = {}; this.myKills = 0; this.respawnAt = null;
    this.multiplayer = !!this.net;
    const authority = !this.net || this.net.isHost;
    const titan = m.side === 'titan';
    if (titan) {
      this.soldier.reset();
      this.soldier.m.root.visible = false;
      this.titanPlayer.setType(this.titanType || RANDOM_TITAN);
      this.player = this.titanPlayer;
      this.titanPlayer.spawn(GATE_CX, D - 40, Math.PI);
      this.camYaw = 0; this.camPitch = -0.1;
      this.world.dirtyFlag = true;
    } else {
      this.titanPlayer.m.root.visible = false;
      this.titanPlayer.reset();
      this.player = this.soldier;
      this.spawnSoldier();
      this.camYaw = Math.PI; this.camPitch = 0.05;
      if (authority) { const n = Math.min(m.titans.max, 3); for (let i = 0; i < n; i++) this.spawnTitan(m.titans); }
    }
    this.camTarget.copy(this.player.pos);
    this.hud.setMode(m.side, m, titan ? this.titanPlayer.type : null);
    this.hud.show(true);
    this.hud.banner(m.name.toUpperCase(), titan ? this.titanPlayer.type.name : (m.tag || '').split('·').pop().trim());
    setTimeout(() => { if (this.mission === m && this.state === 'play') this.hud.radio(m.quote || m.desc, true); }, 1200);
    $('#touch').classList.add('play');
    this.state = 'play';
    this.input.lock();
    audio.init();
    audio.setVolumes(this.settings.vol, this.settings.music);
    audio.startMusic();
  }

  // Players start side by side at the gate.
  spawnSoldier() {
    const idx = this.net ? (this.net.players.get(this.net.selfId)?.index || 0) : 0;
    const x = GATE_CX + ((idx % 4) - 1.5) * 2.2, z = WALLZ + 9 + Math.floor(idx / 4) * 2.5;
    this.soldier.spawn(x, this.world.topY(x, z), z, 0);
    this.soldier.m.root.visible = true;
  }

  spawnTitan(cfg, menu = false) {
    let x, z;
    for (let a = 0; a < 15; a++) {
      x = rand(12, W - 12);
      z = cfg.far ? rand(WALLZ + 70, D - 8) : rand(WALLZ + 25, D - 8);
      if (!this.player || Math.hypot(x - this.player.pos.x, z - this.player.pos.z) > 45) break;
    }
    const height = cfg.h[0] + (cfg.h[1] - cfg.h[0]) * Math.pow(Math.random(), 0.8);
    const t = new Titan(this, { height, abnormal: !menu && Math.random() < cfg.abnormal, x, z });
    this.titans.push(t);
    return t;
  }

  spawnAlly(x, z) {
    if (this.titans.filter((t) => !t.dead && t.ally).length >= 6) return;
    x = clamp(x, 6, W - 6); z = clamp(z, 6, D - 6);
    const t = new Titan(this, { height: rand(6, 12), x, z, ally: true });
    this.titans.push(t);
    this.particles.steam(x, this.world.groundY(x, z) + 3, z, 8, 6);
  }

  // A severed limb: a copy of the limb mesh that tumbles to the ground and steams away.
  spawnChunk(titan, limb) {
    const src = limb.children[0];
    src.updateMatrixWorld(true);
    const mesh = new THREE.Mesh(src.geometry, src.material);
    src.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    this.scene.add(mesh);
    const out = mesh.position.clone().sub(titan.pos).setY(0).normalize();
    this.chunks.push({ mesh, vel: out.multiplyScalar(5).setY(6), spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), t: 0, h: titan.height });
  }

  updateChunks(dt) {
    for (const c of this.chunks) {
      c.t += dt;
      c.vel.y -= 20 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      const gy = this.world.groundY(c.mesh.position.x, c.mesh.position.z) + c.h * 0.05;
      if (c.mesh.position.y < gy) { c.mesh.position.y = gy; c.vel.multiplyScalar(0.3); c.vel.y = 0; c.spin.multiplyScalar(0.3); }
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (Math.random() < 0.4) this.particles.steam(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, c.h * 0.12, 1);
      if (c.t > 4) c.mesh.scale.multiplyScalar(1 - dt * 1.2);
      if (c.t > 6) { this.scene.remove(c.mesh); c.done = true; }
    }
    this.chunks = this.chunks.filter((c) => !c.done);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    for (const c of [...this.input.down]) this.input.release(c);
    this.input.unlock();
    audio.setGas(0); audio.setWind(0);
    $('#setFp').checked = !!this.settings.fp;
    $('#setMusic').value = this.settings.music;
    this.showScreen('pause');
  }
  resume() {
    this.showScreen(null);
    this.state = 'play';
    this.input.lock();
  }

  rankFor(win) {
    if (!win) return 'D';
    const perMin = this.score / Math.max(0.5, this.elapsed / 60);
    return perMin > 6000 ? 'S' : perMin > 3500 ? 'A' : perMin > 1800 ? 'B' : 'C';
  }

  end(win, reason) {
    if (this.state !== 'play' && !(this.net && this.state === 'paused')) return;
    if (this.net && this.net.isHost) this.net.broadcast({ t: T.END, win, reason, board: this.net.boardMsg() });
    this.closeChat();
    this.state = 'result';
    this.input.unlock();
    audio.setGas(0); audio.setWind(0);
    audio.play(win ? 'win' : 'lose');
    const m = this.mission;
    const key = 'best_' + m.id + (m.side === 'titan' && this.titanType ? '_' + this.titanType.id : '');
    const best = store(key) || 0;
    if (this.score > best) store(key, this.score);
    if (!m.free) { const b = store('best_' + m.id) || 0; if (this.score > b) store('best_' + m.id, this.score); }
    const idx = MISSIONS.indexOf(m);
    if (win && this.campaign && idx >= 0) store('campaign', Math.max(store('campaign') || 0, idx + 1));
    $('#resTitle').textContent = win ? 'MISJA ZALICZONA' : 'POLEGŁEŚ';
    $('#resTitle').className = 'res-title ' + (win ? 'win' : 'lose');
    const rank = this.rankFor(win);
    $('#resRank').textContent = rank;
    $('#resRank').className = 'rank ' + rank;
    $('#resSub').textContent = reason;
    const rows = [['PUNKTY', this.score.toLocaleString()], ['REKORD', Math.max(best, this.score).toLocaleString()], ['ZABICI', this.kills], ['NAJLEPSZY ŁAŃCUCH', '×' + Math.max(1, this.bestChain)], ['CZAS', fmtTime(this.elapsed)]];
    if (m.side === 'titan') rows.unshift(['TYTAN', this.titanPlayer.type.name]);
    $('#resStats').innerHTML = rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    $('#nextBtn').style.display = win && this.campaign && idx >= 0 && idx < MISSIONS.length - 1 ? '' : 'none';
    $('#retryBtn').style.display = '';
    $('#nextBtn').textContent = 'Następna misja';
    if (this.net) {
      const rowsMp = [...this.net.players.values()].sort((a, b) => b.score - a.score)
        .map((p, i) => `<span>${i + 1}. ${p.name}${p.id === this.net.selfId ? ' (ty)' : ''}</span><span>${p.score.toLocaleString()} · ${p.kills} zab.</span>`);
      $('#resStats').innerHTML = rowsMp.join('') + `<span>ZESPÓŁ</span><span>${this.kills} tytanów · ${fmtTime(this.elapsed)}</span>`;
      $('#resRank').textContent = win ? rank : '';
      if (this.net.isHost) { $('#nextBtn').style.display = ''; $('#nextBtn').textContent = 'Wróć do lobby'; }
      else { $('#retryBtn').style.display = 'none'; $('#resSub').textContent = reason + ' · Czekamy na hosta…'; }
    }
    $('#touch').classList.remove('play');
    this.hud.show(false);
    this.speedCtx.clearRect(0, 0, innerWidth, innerHeight);
    this.showScreen('result');
  }

  // Score is added immediately (for goals); the counter catches up as points fly in.
  addScore(n, at) {
    this.score += n;
    if (at) this.hud.points(at, n); else this.bankScore(n);
  }
  bankScore(n) {
    this.shownScore = Math.min(this.score, this.shownScore + n);
    const el = $('#scoreVal');
    el.classList.add('bump');
    clearTimeout(this.bumpT);
    this.bumpT = setTimeout(() => el.classList.remove('bump'), 140);
  }

  // Captain lines, each said once per mission.
  say(key, msg, important) { if (this.said[key]) return; this.said[key] = true; this.hud.radio(msg, important); }

  // ---------- soldier combat ----------
  // Combat is split in two so the same rules run on the P2P host today and on a server later:
  //   resolveAttack(att)  -> authority only: decides what was hit and changes titan state
  //   applyOwnResult(o)   -> the attacker's HUD, score and blade wear
  //   applyEvent(ev)      -> what every other player sees (blood, kills, feed)
  enemyTitans() { return this.titans.filter((t) => !t.dead && !t.ally); }
  titanById(id) { return this.titans.find((t) => t.id === id) || null; }
  titanMeshes() {
    const out = [];
    for (const t of this.titans) if (!t.dead) out.push(...t.m.meshes);
    return out;
  }
  netTime() { return performance.now() / 1000; }
  get selfId() { return this.net ? this.net.selfId : 'local'; }

  hookTarget(origin, dir, max) {
    const o = origin.clone().addScaledVector(dir, Math.max(0, this.camDistActual - 0.5));
    const wh = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, max);
    let best = wh ? { t: wh.t, point: new THREE.Vector3(wh.px, wh.py, wh.pz), object: null } : null;
    this.ray.set(o, dir);
    this.ray.far = best ? best.t : max;
    const hits = this.ray.intersectObjects(this.titanMeshes(), false);
    if (hits.length) best = { t: hits[0].distance, point: hits[0].point.clone(), object: hits[0].object };
    if (best && this.soldier.chest.distanceTo(best.point) > HOOK_RANGE) return null;
    return best;
  }

  // Everyone a titan may try to eat (authority side).
  titanTargets() {
    const out = [];
    const s = this.soldier;
    if (this.player === s && !s.dead && !s.grabbedBy) {
      out.push({ pos: s.pos, chest: s.chest, hit: (dmg, t) => s.hit(dmg, t.pos), grab: (t) => s.grab(t) });
    }
    if (this.net && this.net.isHost) {
      for (const p of this.net.remoteTargets()) {
        const r = p.remote;
        if (r.state.grabbed) continue;
        out.push({
          pos: r.pos, chest: r.chest,
          hit: (dmg, t) => this.net.toPlayer(p.id, { t: T.HURT, dmg, from: vec(t.pos) }),
          grab: (t) => { t.holdingRemote = p.id; this.net.toPlayer(p.id, { t: T.GRAB, tid: t.id }); },
        });
      }
    }
    return out;
  }
  isHeldBy(t) {
    if (this.soldier.grabbedBy === t) return true;
    return !!t.holdingRemote && this.time - (t.holdStart || 0) < 3.6;
  }
  onGrabEnd(t, freed) {
    if (this.net && this.net.isClient) { this.net.sendAction('grabEnd', { tid: t.id, cut: freed }); return; }
    t.holdingRemote = null;
  }

  // What the attacker sends to the authority.
  attackData(p, kind, extra = {}) {
    return {
      kind, chest: vec(p.chest), pos: vec(p.pos), speed: p.speed, air: p.airborne, plunge: !!p.plunge,
      spinSum: p.spin.reduce((a, e) => a + e[1], 0), blade: p.blade, ...extra,
    };
  }

  trySlash(p, opts = {}) {
    if (p.blade <= 0) { this.hud.toast(p.sets > 0 ? 'TĘPE OSTRZA · R' : 'BRAK OSTRZY · UZUPEŁNIJ'); audio.play('clang', 0.5); return; }
    this.submitAttack(this.attackData(p, 'slash', { finisher: !!opts.finisher }));
  }
  spinHit(p, tag) {
    if (p.blade <= 0) return;
    this.submitAttack(this.attackData(p, 'spin', { tag }));
  }
  submitAttack(a) {
    if (this.net && this.net.isClient) { this.net.sendAction('attack', a); return; }
    const o = this.resolveAttack(this.selfId, a);
    if (o) this.deliver(this.selfId, o);
  }

  // Authority: a remote player did something.
  authorityAction(from, m) {
    if (m.k === 'attack') { const o = this.resolveAttack(from, m); if (o) this.deliver(from, o); }
    else if (m.k === 'grabEnd') {
      const t = this.titanById(m.tid);
      if (t && !t.dead) {
        t.holdingRemote = null;
        if (m.cut) { const label = t.cutPart(t.attackArm === 'L' ? 'armL' : 'armR', t.handWorld()); this.net.broadcast({ t: T.EV, e: 'cut', tid: t.id, part: t.attackArm === 'L' ? 'armL' : 'armR', at: vec(t.handWorld()), by: from, label }); }
      }
    } else if (m.k === 'died') this.onChat(null, `${this.net.name(from)} poległ(a)`);
  }

  napeReach(t, bonus = 1) { return (4.4 + t.height * 0.08) * bonus; }

  partNear(t, point, bonus = 1) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), seg = new THREE.Line3();
    let best = null, bd = Infinity;
    const eyes = t.eyesWorld();
    const de = eyes.distanceTo(point);
    if (de < (2.2 + t.height * 0.08) * bonus) { best = { part: 'eyes', point: eyes }; bd = de * 0.8; }
    const limbs = [['armL', t.m.armL, 14], ['armR', t.m.armR, 14], ['legL', t.m.legL, 12], ['legR', t.m.legR, 12]];
    for (const [part, limb, len] of limbs) {
      limb.getWorldPosition(a);
      limb.localToWorld(b.set(0, -len * t.m.px, 0));
      seg.set(a, b).closestPointToPoint(point, true, c);
      const d = c.distanceTo(point);
      if (d < (2.3 + t.height * 0.09) * bonus && d < bd) { bd = d; best = { part, point: c.clone() }; }
    }
    return best;
  }

  // Authority: decide the outcome of one attack and change the titans accordingly.
  resolveAttack(by, a) {
    if (!(a.blade > 0)) return null;
    const chest = new THREE.Vector3(...a.chest), pos = new THREE.Vector3(...a.pos);
    const spin = a.kind === 'spin';
    const bonus = spin ? 1.2 : (a.plunge ? 1.5 : 1) * (a.finisher ? 1.35 : 1);
    const nape = new THREE.Vector3();
    let frontal = false;
    for (const t of this.enemyTitans()) {
      t.napeWorld(nape);
      if (chest.distanceTo(nape) < this.napeReach(t, bonus)) {
        const back = chest.clone().sub(nape).setY(0);
        const side = a.finisher ? 0.65 : 0.3;
        const behind = spin || back.lengthSq() < 0.04 || t.forward().dot(back.normalize()) < side || chest.y > nape.y + 1.2 || t.down;
        if (behind) {
          const tags = spin ? [a.tag] : [...(a.plunge ? ['NURKOWANIE'] : []), ...(a.finisher ? ['WIR'] : [])];
          return this.killTitanSim(by, t, a, nape.clone(), tags);
        }
        frontal = true;
      }
    }
    for (const t of this.enemyTitans()) {
      if (t.pos.distanceTo(pos) > t.height * 1.5 + 8) continue;
      if (spin && t.spinCutAt && this.time - t.spinCutAt < 0.35) continue;
      const hit = this.partNear(t, chest, bonus);
      if (hit) {
        if (spin) t.spinCutAt = this.time;
        const label = t.cutPart(hit.part, hit.point);
        const big = label === 'POWALONY' || label === 'ROZBROJONY';
        const pts = { eyes: 300, armL: 200, armR: 200, legL: 250, legR: 250 }[hit.part] + (big ? 300 : 0);
        if (this.net) this.net.credit(by, pts, false);
        return { k: 'cut', tid: t.id, part: hit.part, at: vec(hit.point), label, pts };
      }
    }
    return frontal && !spin ? { k: 'front' } : null;
  }

  killTitanSim(by, t, a, nape, extra) {
    t.kill();
    this.kills++;
    if (t.abnormal) this.abnormalKills++;
    const ch = (this.chains[by] ||= { n: 0, end: 0, last: -99 });
    const now = this.time, tags = [...extra];
    let mult = 1 + extra.length * 0.35;
    if (a.speed > 24) { tags.push('SZYBKOŚĆ'); mult += 0.25; }
    if (a.air) { tags.push('Z POWIETRZA'); mult += 0.15; }
    if (!extra.includes('MŁYNEK') && a.spinSum > 3.5) { tags.push('OBRÓT'); mult += 0.3; }
    if (now - ch.last < 4) { tags.push('SZYBKO'); mult += 0.2; }
    if (t.abnormal) { tags.push('ODMIENIEC'); mult += 0.5; }
    const dbl = now - ch.last < 1.6;
    ch.n = now < ch.end ? ch.n + 1 : 1;
    ch.last = now; ch.end = now + 6;
    const cm = 1 + 0.25 * (ch.n - 1);
    const pts = Math.round((800 + t.height * 90) * mult * cm);
    if (this.net) this.net.credit(by, pts, true);
    return { k: 'kill', tid: t.id, at: vec(nape), pts, tags, dbl, chain: ch.n, cm, h: Math.round(t.height), ab: t.abnormal };
  }

  // Send an outcome to whoever attacked, and let everyone see it.
  deliver(by, o) {
    if (o.k === 'kill') this.fxKill(new THREE.Vector3(...o.at));
    if (this.net && this.net.isHost && o.k !== 'front') this.net.broadcast({ t: T.EV, e: o.k, by, ...o });
    if (by === this.selfId) this.applyOwnResult(o);
    else if (this.net) {
      this.net.toPlayer(by, { t: T.RES, o });
      if (o.k === 'kill') this.hud.feed(`${this.net.name(by)}: ${o.ab ? 'ODMIENIEC' : 'TYTAN'} ${o.h} m`);
      else if (o.k === 'cut') this.hud.feed(`${this.net.name(by)}: ${o.label}`);
    }
  }

  fxKill(at) {
    this.particles.blood(at.x, at.y, at.z, 90, 16);
    for (let i = 0; i < 6; i++) this.particles.puff(at.x, at.y, at.z, rand(-6, 6), rand(0, 6), rand(-6, 6), 3, 1.2, 0xc02020, 0.6, 2.5);
  }

  // Everyone else's view of an attack (clients only; the authority already saw it happen).
  applyEvent(m) {
    if (m.by === this.selfId) {
      // still need the visuals on our side
    }
    const at = new THREE.Vector3(...m.at);
    const t = this.titanById(m.tid);
    if (m.e === 'kill') {
      if (t && !t.dead) t.kill();
      this.fxKill(at);
      this.kills++;
      if (m.by !== this.selfId) this.hud.feed(`${this.net.name(m.by)}: ${m.ab ? 'ODMIENIEC' : 'TYTAN'} ${m.h} m`);
    } else if (m.e === 'cut') {
      if (t) t.cutFx(m.part, at);
      if (m.by !== this.selfId) this.hud.feed(`${this.net.name(m.by)}: ${m.label}`);
    }
  }

  // The attacker's own feedback: score, popups, blade wear, juice.
  applyOwnResult(o) {
    const p = this.soldier;
    if (o.k === 'front') { this.hud.toast('ZAJDŹ GO OD TYŁU'); audio.play('clang', 0.6); p.blade = Math.max(0, p.blade - 4); return; }
    const at = new THREE.Vector3(...o.at);
    if (o.k === 'cut') {
      this.addScore(o.pts, at);
      p.blade = Math.max(0, p.blade - 8);
      this.hud.feed(o.label);
      if (o.label === 'POWALONY') { this.hud.toast('TYTAN POWALONY · TNIJ KARK'); this.say('down', 'Leży! Teraz kark, szybko, zanim wstanie!', true); }
      audio.play('cut', 0.6);
      if (!this.multiplayer) this.hitStop = Math.max(this.hitStop, 0.04);
      this.fovKick = Math.max(this.fovKick, 3);
      this.shake(0.25);
      return;
    }
    // kill
    this.myKills++;
    this.chainN = o.chain; this.bestChain = Math.max(this.bestChain, o.chain);
    this.lastKill = this.time; this.chainEnd = this.time + 6;
    this.addScore(o.pts, at);
    this.hud.popup(o.dbl ? 'PODWÓJNE ZABÓJSTWO' : 'CIĘCIE KARKU!', o.tags.join(' · '), `+${o.pts.toLocaleString()}${o.cm > 1 ? ` ×${o.cm}` : ''}`);
    this.hud.chain(o.chain);
    if (o.chain > 1) audio.play('chain');
    if (o.chain === 3) this.hud.radio('Trzy z rzędu! Tak trzymać, żołnierzu!');
    else if (this.myKills === 1) this.say('first', 'Pierwszy padł. Dobra robota, leć dalej.');
    this.hud.feed(`${o.ab ? 'ODMIENIEC' : 'TYTAN'} ${o.h} m ZABITY`);
    p.blade = Math.max(0, p.blade - 20);
    audio.play('cut');
    this.hud.flash('kflash');
    this.fovKick = 10;
    if (!this.multiplayer) { this.slowT = 0.55; this.hitStop = 0.05; }
    if (p.spinT > 0) p.spinT = Math.min(p.spinT, 0.15);
    if (p.lungeT > 0) p.lungeT = Math.min(p.lungeT, 0.05);
    this.shake(0.6);
  }

  spinTarget(p) {
    let best = null, bd = 24;
    const n = new THREE.Vector3();
    for (const t of this.enemyTitans()) {
      t.napeWorld(n);
      const d = n.distanceTo(p.chest);
      if (d < bd) { bd = d; best = n.clone(); }
    }
    return best;
  }

  // Nape roughly where you're looking (charged lunge auto-aim).
  lungeTarget(p) {
    let best = null, bc = Math.cos(0.45);
    const n = new THREE.Vector3();
    for (const t of this.enemyTitans()) {
      t.napeWorld(n);
      const d = n.clone().sub(p.chest);
      const len = d.length();
      if (len > 38) continue;
      const c = d.divideScalar(len).dot(this.camDir);
      if (c > bc) { bc = c; best = d.clone(); }
    }
    return best;
  }

  // ---------- network glue (client side) ----------
  applyTitanSnapshot(list, now) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let t = this.titanById(s.id);
      if (!t) {
        t = new Titan(this, { height: s.height, abnormal: s.abnormal, ally: s.ally, x: s.pos[0], z: s.pos[2], id: s.id, puppet: true });
        this.titans.push(t);
      }
      if (!t.dead) t.pushNet(s, now);
    }
    // titans the authority no longer sends (and that didn't die on screen) are gone
    for (const t of this.titans) if (!seen.has(t.id) && !t.dead && t.puppet && now - (t.lastNet || 0) > 1.5) t.remove = true;
  }

  applyBoard(m) {
    this.kills = m.kills; this.abnormalKills = m.abnormals; this.district = m.district;
    if (this.state === 'play') this.elapsed = m.elapsed;
    this.renderBoard();
  }

  // ---------- titan-mode combat ----------
  killScout(s, label) {
    if (s.dead) return;
    s.kill();
    this.kills++;
    const pts = 250 + (this.time - this.lastKill < 3 ? 150 : 0);
    this.addScore(pts, s.pos.clone().setY(s.pos.y + 1));
    this.lastKill = this.time;
    this.hud.feed(label);
    audio.play('cut', 0.5);
  }
  damageScout(s, dmg, label) {
    if (s.dead) return;
    s.hp -= dmg;
    if (s.hp <= 0) { this.killScout(s, label); return; }
    s.stun(1.4, false);
    s.vel.set(rand(-8, 8), 9, rand(-8, 8));
    this.particles.blood(s.pos.x, s.pos.y + 1, s.pos.z, 8, 5);
    this.addScore(80, s.pos.clone().setY(s.pos.y + 1));
    audio.play('cut', 0.3);
  }
  killScoutsNear(p, r, label) {
    for (const s of this.scouts) if (!s.dead && s.pos.distanceTo(p) < r) this.killScout(s, label);
  }

  onTitanAtGate(t, dt) {
    this.district -= dt * (t.height / 15) * 1.5;
    if (this.district < 50) this.say('gate50', 'Brama pęka! Zdejmij ich spod muru!', true);
    if (this.district <= 0) { this.district = 0; this.end(false, 'Tytany wdarły się do dzielnicy.'); }
  }
  onPlayerHurt(amount) { this.hud.flash(); this.shake(Math.min(1, amount / 30)); }
  onPlayerDeath() {
    if (this.net && this.player === this.soldier) {
      // online you come back after a few seconds instead of losing the mission
      this.respawnAt = this.time + NET.respawn;
      this.hud.banner('POLEGŁEŚ', `Odrodzenie za ${NET.respawn} s`);
      if (this.net.isClient) this.net.sendAction('died', {}); else this.onChat(null, `${this.net.name('host')} poległ(a)`);
      return;
    }
    this.deathAt = this.time;
  }
  shake(a) { this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, a)); }

  // ---------- frame ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = (now - this.last) / 1000;
    let dt = Math.min(0.05, raw);
    this.last = now;
    this.trackFps(raw);
    const realDt = dt;
    if (this.state === 'paused' && this.net) {
      // online there is no pause: the match keeps running for everyone else
      this.time += dt;
      this.updatePlay(dt, realDt);
    } else if (this.state === 'play') {
      const inp = this.input;
      if (this.net) $('#board').classList.toggle('on', inp.held('Tab'));
      if (inp.pressed('Escape') && inp.touch) this.pause();
      if (inp.pressed('KeyH')) this.hud.toggleKeys();
      if (inp.pressed('KeyM')) {
        this.settings.music = this.settings.music > 0.75 ? 0.5 : this.settings.music > 0 ? 0 : 1;
        this.applySettings();
        this.hud.toast(`MUZYKA: ${this.settings.music === 1 ? 'PEŁNA' : this.settings.music ? 'POŁOWA' : 'WYŁĄCZONA'}`);
      }
      if (inp.pressed('KeyV') && this.player === this.soldier) { this.settings.fp = !this.settings.fp; this.applySettings(); }
      if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.1; }
      else if (this.slowT > 0) { this.slowT -= dt; dt *= 0.3 + 0.7 * Math.max(0, 1 - this.slowT / 0.55) ** 2; }
      this.time += dt;
      this.updatePlay(dt, realDt);
    } else {
      this.time += dt;
      if (this.state === 'menu') this.updateMenu(dt);
      else this.speedCtx.clearRect(0, 0, innerWidth, innerHeight);
    }
    this.particles.update(dt);
    this.updateChunks(dt);
    if (this.net) this.net.tick(realDt);
    this.world.rebuildDirty(this.player === this.titanPlayer ? 10 : 4);
    this.clouds.position.x = W / 2 + ((this.time * 1.5) % 120) - 60;
    this.sky.position.copy(this.camera.position);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.particles.puffs.material.uniforms.scale.value = s.y / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  // FPS readout + dynamic resolution: drop the render scale when frames get slow.
  trackFps(raw) {
    this.fpsFrames++; this.fpsT += raw;
    if (this.fpsT < 1) return;
    this.fps = this.fpsFrames / this.fpsT;
    this.fpsFrames = 0; this.fpsT = 0;
    if (this.state === 'play' || this.state === 'menu') {
      let pr = this.pr;
      if (this.drsPrev) {
        // lowering the resolution did not help (CPU- or vsync-limited): undo and stop trying
        if (this.fps < this.drsPrev.fps * 1.1) { pr = this.drsPrev.pr; this.drsStuck = true; }
        this.drsPrev = null;
      } else if (this.fps < 45 && pr > 0.6 && !this.drsStuck) {
        this.drsPrev = { pr, fps: this.fps };
        pr = Math.max(0.6, pr - 0.15);
      } else if (this.fps > 57 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.05);
      if (pr !== this.pr) { this.pr = pr; this.renderer.setPixelRatio(pr); this.resize(); }
    }
    const info = this.renderer.info.render;
    $('#fps').textContent = `${Math.round(this.fps)} FPS · skala ${this.pr.toFixed(2)} · ${QUALITY[this.qualityKey].label} · ${(info.triangles / 1000).toFixed(0)}k trójkątów · ${info.calls} wywołań`;
  }

  updateMenu(dt) {
    for (const t of this.titans) t.update(dt);
    this.menuA += dt * 0.04;
    const c = new THREE.Vector3(GATE_CX, 20, WALLZ + 40);
    this.camera.position.set(c.x + Math.sin(this.menuA) * 75, 62, c.z + Math.cos(this.menuA) * 75);
    this.camera.lookAt(c.x, 22, c.z);
    this.speedCtx.clearRect(0, 0, innerWidth, innerHeight);
  }

  updatePlay(dt, realDt) {
    const m = this.mission, input = this.input;
    this.elapsed += dt;
    const sens = input.sensitivity;
    this.camYaw -= input.dx * sens;
    this.camPitch = clamp(this.camPitch - input.dy * sens * (this.settings.invert ? -1 : 1), -1.35, 1.25);
    const cp = Math.cos(this.camPitch);
    this.camDir.set(-Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), -Math.cos(this.camYaw) * cp);

    this.player.update(dt, input);

    if (m.side === 'soldier') {
      const p = this.soldier;
      for (const s of this.world.supplies) {
        if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 4.5 && Math.abs(p.pos.y - s.y) < 4 && p.resupply()) {
          this.hud.toast('UZUPEŁNIONO'); audio.play('supply');
          this.said.gas = false; this.said.blades = false;
        }
      }
      if (p.gas < 25) this.say('gas', 'Kończy ci się gaz! Leć do niebieskiego promienia, tam uzupełnisz.', true);
      if (p.sets === 0 && p.blade < 30) this.say('blades', 'Ostatnia para ostrzy. Wracaj do zaopatrzenia!', true);
      if (p.hp < 35 && !p.dead) this.say('hp', 'Krwawisz! Odskocz i złap oddech, zdrowie samo wraca.', true);
      if (!this.said.near && this.enemyTitans().some((t) => t.pos.distanceTo(p.pos) < 40)) this.say('near', 'Tytan blisko. Zajdź go od tyłu, cel w kark. Czerwony „!” = zaraz uderzy.');
      if (this.respawnAt && this.time >= this.respawnAt) { this.respawnAt = null; this.spawnSoldier(); this.hud.toast('WRACASZ DO WALKI'); }
      const cfg = m.titans;
      const alive = this.enemyTitans().length;
      const cap = cfg.max + (cfg.ramp ? Math.floor(this.elapsed / 35) : 0);
      this.spawnT -= dt;
      const extra = this.net ? Math.min(6, this.net.count - 1) * 2 : 0; // more players, more titans
      if ((!this.net || this.net.isHost) && alive < Math.min(16, cap + extra) && this.spawnT <= 0) { this.spawnTitan(cfg); this.spawnT = 2.5; }
    } else {
      const T = this.titanPlayer;
      this.spawnT -= dt;
      const want = Math.min(10, 3 + Math.floor(this.elapsed / 25));
      if (!T.dead && this.scouts.filter((s) => !s.dead).length < want && this.spawnT <= 0) {
        const a = Math.random() * Math.PI * 2;
        const pos = new THREE.Vector3(clamp(T.pos.x + Math.cos(a) * 45, 4, W - 4), T.pos.y + T.height + 15, clamp(T.pos.z + Math.sin(a) * 45, 4, D - 4));
        this.scouts.push(new Scout(this, pos));
        this.spawnT = 2;
      }
      for (const s of this.scouts) s.update(dt);
      this.scouts = this.scouts.filter((s) => (s.remove ? (s.dispose(), false) : true));
      this.gateCheckT -= dt;
      if (this.gateCheckT <= 0) {
        this.gateCheckT = 0.4;
        this.gatePct = (100 * this.world.countGate()) / this.world.gateTotal;
        if (!this.gateBroken && (this.gatePct < 30 || T.pos.z < WALLZ - 3)) {
          this.gateBroken = true;
          this.hud.popup('MUR PRZEŁAMANY', 'DZIELNICA STOI OTWOREM', '+5 000');
          this.addScore(5000);
          audio.play('roar');
        }
      }
    }
    for (const t of this.titans) t.update(dt);
    this.titans = this.titans.filter((t) => (t.remove ? (t.dispose(), false) : true));

    if (this.chainN > 1 && this.time > this.chainEnd) { this.hud.feed(`KONIEC ŁAŃCUCHA ×${this.chainN}`); this.chainN = 0; this.hud.chain(0); }

    const g = this.net && this.net.isClient ? null : m.goal; // online, only the authority decides the outcome
    if (this.deathAt !== null && this.time - this.deathAt > 1.6) this.end(false, m.side === 'titan' ? 'Zwiadowcy ścięli ci kark.' : 'Dopadł cię tytan.');
    else if (g) {
      if (g.kills && this.kills >= g.kills) this.end(true, `Zabitych tytanów: ${this.kills}.`);
      if (g.abnormals && this.abnormalKills >= g.abnormals) this.end(true, 'Odmieńcy leżą.');
      if (g.survive && this.elapsed >= g.survive) this.end(true, 'Linia obrony wytrzymała.');
      if (g.gate && this.gateBroken) this.end(true, 'Z bramy zostały gruzy. Ostoja stoi otworem.');
      if (m.time && this.elapsed >= m.time && this.state === 'play') this.end(false, 'Koniec czasu.');
    }

    this.updateCamera(realDt);
    this.updateHUD(realDt);
    const near = m.side === 'soldier' ? this.enemyTitans().filter((t) => t.pos.distanceTo(this.soldier.pos) < 45).length : this.scouts.filter((s) => !s.dead).length;
    audio.intensity = damp(audio.intensity, Math.min(1, near * 0.3 + (this.soldier.speed > 25 ? 0.2 : 0)), 1, dt);
  }

  updateCamera(dt) {
    const titan = this.player === this.titanPlayer;
    const fp = !titan && this.settings.fp;
    const P = this.player;
    const raw = titan ? P.pos.clone().setY(P.pos.y + P.height * 0.95) : P.pos.clone().setY(P.pos.y + (fp ? 1.62 : 1.55));
    // a little follow lag sells the speed; snap if we fell too far behind (respawn) or in first person
    if (this.camTarget.distanceTo(raw) > 12 || fp) this.camTarget.copy(raw);
    this.camTarget.x = damp(this.camTarget.x, raw.x, 16, dt);
    this.camTarget.y = damp(this.camTarget.y, raw.y, 16, dt);
    this.camTarget.z = damp(this.camTarget.z, raw.z, 16, dt);
    const target = this.camTarget;
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    if (fp) {
      this.camDistActual = 0;
      this.camera.position.copy(target);
    } else {
      const want = titan ? Math.max(5, P.height * 1.25) : 4.8;
      const desired = target.clone().addScaledVector(this.camDir, -want).addScaledVector(right, titan ? P.height * 0.2 : 0.7);
      if (!titan) desired.y += 0.3;
      const d = desired.clone().sub(target);
      const len = d.length();
      d.divideScalar(len);
      const hit = this.world.raycast(target.x, target.y, target.z, d.x, d.y, d.z, len);
      const L = hit ? Math.max(0.6, hit.t - 0.35) : len;
      this.camDistActual = L < (this.camDistActual || L) ? L : damp(this.camDistActual, L, 6, dt);
      this.camera.position.copy(target).addScaledVector(d, this.camDistActual);
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      this.camera.position.add(new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s)));
    }
    this.camera.lookAt(this.camera.position.clone().add(this.camDir));
    // lean into turns
    const lateral = titan ? 0 : this.soldier.vel.dot(right);
    this.camRoll = damp(this.camRoll, clamp(-lateral / 120, -0.12, 0.12), 4, dt);
    this.camera.rotateZ(this.camRoll);
    if (!titan && this.soldier.invuln <= 0 && !this.soldier.grabbedBy) this.soldier.m.root.visible = !fp && this.camDistActual > 1.3;
    const speed = titan ? 0 : this.soldier.speed;
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    const fov = 72 + clamp((speed - 12) * 0.55, 0, 20) + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = damp(this.camera.fov, fov, 6, dt); this.camera.updateProjectionMatrix(); }
    this.drawSpeedLines(speed);
  }

  drawSpeedLines(speed) {
    const c = this.speedCtx, w = innerWidth, h = innerHeight;
    if (this.speedDrawn) c.clearRect(0, 0, w, h);
    this.speedDrawn = speed >= 22;
    if (!this.speedDrawn) return;
    const n = Math.min(60, (speed - 22) * 2);
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r0 = R * (0.55 + Math.random() * 0.3), r1 = r0 + R * (0.1 + Math.random() * 0.25);
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    c.stroke();
  }

  updateHUD(dt) {
    const hud = this.hud, q = hud.q, m = this.mission;
    hud.updatePoints(dt);
    this.drawMinimap();
    const tt = m.time ? fmtTime(m.time - this.elapsed) : m.goal && m.goal.survive ? fmtTime(m.goal.survive - this.elapsed) : '';
    hud.text('timer', tt);
    hud.text('scoreVal', Math.round(this.shownScore).toLocaleString());
    hud.text('slainN', String(this.kills));
    hud.text('multi', this.chainN > 1 ? `ŁAŃCUCH ×${(1 + 0.25 * (this.chainN - 1)).toFixed(2)}` : '');
    const g = m.goal || {};
    let obj = '', prog = 0;
    if (g.kills) { obj = `Zabij tytany: ${this.kills} / ${g.kills}`; prog = this.kills / g.kills; }
    if (g.abnormals) { obj = `Zabij odmieńców: ${this.abnormalKills} / ${g.abnormals}`; prog = this.abnormalKills / g.abnormals; }
    if (g.survive) { obj = 'Przetrwaj do końca odliczania'; prog = this.elapsed / g.survive; }
    if (g.gate) { obj = 'Rozbij bramę albo przez nią przejdź'; prog = (100 - this.gatePct) / 70; }
    hud.text('objective', obj);
    hud.bar('objBar', prog * 100);

    if (m.side === 'soldier') {
      const p = this.soldier;
      const near = this.enemyTitans().filter((t) => t.pos.distanceTo(p.pos) < 60).length;
      hud.text('counts', `Tytany w pobliżu ${near} · zabite ${this.kills}`);
      hud.text('speed', `${Math.round(p.speed * 3.6)} km/h`);
      hud.bar('hpBar', p.hp); hud.text('hpVal', String(Math.ceil(p.hp)));
      hud.bar('gasBar', p.gas); hud.text('gasVal', Math.ceil(p.gas) + '%');
      hud.text('bladeVal', String(p.sets));
      const dull = p.blade <= 0;
      hud.cls('bL', 'dull', dull); hud.cls('bR', 'dull', dull);
      hud.vis('gasLow', p.gas < 20 && !p.dead);
      hud.vis('grabbed', !!p.grabbedBy);
      if (p.grabbedBy) hud.bar('grabBar', (p.mash / 7) * 100);
      if (m.district) { hud.bar('districtBar', this.district); hud.text('districtPct', Math.ceil(this.district) + '%'); }
      const ht = this.hookTarget(this.camera.position, this.camDir, HOOK_RANGE + 6);
      hud.cls('crosshair', 'lock', !!ht);
      hud.text('hookDist', ht ? `${Math.round(p.chest.distanceTo(ht.point))} m` : '');
      hud.cls('hkL', 'on', p.hooks[0].state === 'attached');
      hud.cls('hkR', 'on', p.hooks[1].state === 'attached');
      let best = null, bd = 45;
      for (const t of this.enemyTitans()) {
        const d = t.pos.distanceTo(p.pos);
        if (d < bd) { bd = d; best = t; }
      }
      const nm = q('napeMarker');
      let ready = false;
      if (best) {
        const n = best.napeWorld();
        const v = n.clone().project(this.camera);
        if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
          nm.style.display = 'block';
          nm.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
          const back = p.chest.sub(n).setY(0);
          ready = p.chest.distanceTo(n) < this.napeReach(best) && (back.lengthSq() < 0.04 || best.forward().dot(back.normalize()) < 0.3 || best.down);
          hud.cls('napeMarker', 'ready', ready);
          hud.text('napeLabel', ready ? 'TNIJ!' : 'KARK');
        } else nm.style.display = 'none';
      } else nm.style.display = 'none';
      hud.cls('crosshair', 'ready', ready);
    } else {
      const T = this.titanPlayer;
      hud.text('counts', `Zwiadowcy ${this.scouts.filter((s) => !s.dead).length} · zabici ${this.kills}`);
      hud.text('speed', T.type.name);
      hud.bar('hpBar', T.nape); hud.text('hpVal', String(Math.ceil(T.nape)));
      hud.bar('districtBar', this.gatePct); hud.text('districtPct', Math.ceil(this.gatePct) + '%');
      hud.vis('gasLow', false); hud.vis('grabbed', false);
      const ab = T.type.abilities;
      const max = { lmb: T.small ? 0.45 : 0.8, rmb: 2, Q: ab.Q && ab.Q.cd, E: ab.E && ab.E.cd, F: ab.F && ab.F.cd };
      for (const el of q('abilities').children) {
        const k = el.dataset.k;
        const pct = max[k] ? Math.round((T.cd[k] / max[k]) * 100) : 0;
        if (el._pct !== pct) { el._pct = pct; el.lastChild.style.height = pct + '%'; }
        const a = ab[k];
        const active = !!a && ((a.type === 'harden' && T.hardenT > 0) || (a.type === 'rage' && T.rageT > 0) || (a.type === 'steam' && T.steamT > 0) || (a.type === 'charge' && T.chargeT > 0) || (a.type === 'cannon' && T.cannonT > 0));
        if (el._act !== active) { el._act = active; el.classList.toggle('active', active); }
      }
      const behind = this.scouts.some((s) => !s.dead && s.threatening);
      if (hud.cache.get('warn') !== behind) { hud.cache.set('warn', behind); q('warning').style.display = behind ? 'block' : 'none'; }
      q('napeMarker').style.display = 'none';
    }
  }
}

window.addEventListener('load', () => setTimeout(() => { window.game = new Game(); }, 30));
