// All sound is synthesized with WebAudio: SFX + a procedural score in D minor.

class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.intensity = 0; // 0 calm .. 1 combat
    this.vol = { master: 0.8, music: 1 };
  }

  setVolumes(master, music) {
    this.vol = { master, music };
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(master, this.t, 0.05);
    this.music.gain.setTargetAtTime(0.32 * music, this.t, 0.05);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.setup(new AC());
    this.loadSavedTrack();
  }

  setup(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32 * this.vol.music; this.music.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb for music / big hits
    this.verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.5, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / c.length, 3);
    }
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    // persistent gas hiss
    this.gasSrc = ctx.createBufferSource(); this.gasSrc.buffer = this.noise; this.gasSrc.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.7;
    this.gasGain = ctx.createGain(); this.gasGain.gain.value = 0;
    this.gasSrc.connect(bp).connect(this.gasGain).connect(this.sfx);
    this.gasSrc.start();
    // wind that scales with speed
    this.windSrc = ctx.createBufferSource(); this.windSrc.buffer = this.noise; this.windSrc.loop = true;
    this.windLp = ctx.createBiquadFilter(); this.windLp.type = 'lowpass'; this.windLp.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windLp).connect(this.windGain).connect(this.sfx);
    this.windSrc.start();
    // soft saturation for growls and roars
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
    this.curve = curve;
  }

  get t() { return this.ctx.currentTime; }

  env(g, t, a, peak, dec) {
    peak = Math.max(0.0002, peak); // exponential ramps can't target 0
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  noiseHit({ type = 'highpass', f = 2000, f2 = null, q = 1, dur = 0.2, vol = 0.5, at = 0, dest = null }) {
    const ctx = this.ctx, t = this.t + at;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.005, vol, dur);
    s.connect(fl).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone({ type = 'sine', f = 440, f2 = null, dur = 0.2, vol = 0.3, at = 0, a = 0.005, dest = null }) {
    const ctx = this.ctx, t = this.t + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); this.env(g, t, a, vol, dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + a + dur + 0.05);
  }

  // Bandpass-swept noise: blades and arms cutting the air.
  swish({ f1 = 700, f2 = 4500, f3 = 1800, q = 1.4, dur = 0.2, vol = 0.4, at = 0, dest = null }) {
    const ctx = this.ctx, t = this.t + at;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f1, t);
    bp.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(f3, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // Inharmonic partials of a struck steel bar: blade ring, clang.
  metal({ f = 2200, dur = 0.4, vol = 0.05, at = 0, verb = 0.3 }) {
    [1, 2.76, 5.4, 8.93].forEach((r, i) => {
      const fr = f * r * (1 + (Math.random() - 0.5) * 0.01);
      if (fr > 16000) return;
      const v = vol / (1 + i * 0.9), d = dur / (1 + i * 0.6);
      this.tone({ type: 'sine', f: fr, dur: d, vol: v, at, a: 0.002 });
      if (verb) this.tone({ type: 'sine', f: fr, dur: d, vol: v * verb, at, a: 0.002, dest: this.verb });
    });
  }
  // Titan flesh evaporating.
  steam(dur = 1, vol = 0.12, at = 0) {
    const ctx = this.ctx, t = this.t + at;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(3500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp).connect(lp).connect(g).connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // Scattered pebbles and chunks hitting the ground.
  rubble(n = 6, spread = 0.6, vol = 0.2, at = 0) {
    for (let i = 0; i < n; i++) {
      const dt = at + Math.pow(Math.random(), 1.6) * spread;
      this.noiseHit({ type: 'bandpass', f: 500 + Math.random() * 2200, q: 2.5, dur: 0.04 + Math.random() * 0.06, vol: vol * (0.4 + Math.random() * 0.6), at: dt });
    }
  }
  // A throat: jittery detuned saws, growl tremolo and saturation, shaped by vowel formants.
  growl({ f0 = 95, f1 = 120, f2 = 65, dur = 1.5, vol = 0.3, at = 0, form = [520, 1000, 2300], rough = 0.45, breath = 0.25, verb = 0.5 }) {
    const ctx = this.ctx, t = this.t + at, end = t + dur;
    const mix = ctx.createGain(); mix.gain.value = 0.35;
    const am = ctx.createGain(); am.gain.value = 1 - rough * 0.5;
    const trem = ctx.createOscillator(); trem.frequency.value = 26 + Math.random() * 14;
    const tg = ctx.createGain(); tg.gain.value = rough * 0.5;
    trem.connect(tg).connect(am.gain);
    const jit = ctx.createBufferSource(); jit.buffer = this.noise; jit.loop = true;
    const jl = ctx.createBiquadFilter(); jl.type = 'lowpass'; jl.frequency.value = 18;
    const jg = ctx.createGain(); jg.gain.value = f0 * 0.5;
    jit.connect(jl).connect(jg);
    const oscs = [[1, 0, 1], [1, 9, 0.8], [0.5, -4, 0.7], [2, 5, 0.25]].map(([m, det, g]) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.setValueAtTime(f0 * m, t);
      o.frequency.linearRampToValueAtTime(f1 * m, t + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(f2 * m, end);
      jg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(mix);
      return o;
    });
    const sh = ctx.createWaveShaper(); sh.curve = this.curve;
    mix.connect(am).connect(sh);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + Math.min(0.15, dur * 0.2));
    out.gain.setValueAtTime(vol, t + dur * 0.55);
    out.gain.linearRampToValueAtTime(0.0001, end);
    form.forEach((ff, i) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 4 + i * 2;
      const fg = ctx.createGain(); fg.gain.value = [2.2, 1.3, 0.5][i] || 0.3;
      sh.connect(bp).connect(fg).connect(out);
    });
    const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 260;
    const lg = ctx.createGain(); lg.gain.value = 0.6;
    sh.connect(lo).connect(lg).connect(out);
    if (breath) {
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = form[0] * 1.3; nb.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = breath;
      n.connect(nb).connect(ng).connect(out);
      n.start(t, Math.random()); n.stop(end + 0.05);
    }
    out.connect(this.sfx);
    if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; out.connect(vg).connect(this.verb); }
    for (const o of [...oscs, trem]) { o.start(t); o.stop(end + 0.05); }
    jit.start(t, Math.random()); jit.stop(end + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || !this.enabled || !(vol > 0.01)) return;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'hook':
        // anchor firing: short airy hiss + a light mechanical tick
        this.noiseHit({ f: 3200, f2: 1200, dur: 0.1, vol: 0.18 * vol });
        this.tone({ type: 'triangle', f: 1600, f2: 900, dur: 0.04, vol: 0.04 * vol });
        break;
      case 'hookHit':
        // anchor biting in: soft low thunk, a tiny metallic tick and the wire going taut
        this.tone({ type: 'sine', f: 150, f2: 70, dur: 0.12, vol: 0.14 * vol });
        this.noiseHit({ type: 'bandpass', f: 2600, q: 3, dur: 0.035, vol: 0.07 * vol });
        this.tone({ type: 'triangle', f: 1900, f2: 1750, dur: 0.06, vol: 0.022 * vol, at: 0.01 });
        this.tone({ type: 'sine', f: 420, f2: 520, dur: 0.18, vol: 0.02 * vol, at: 0.03 });
        break;
      case 'slash':
        // blade through air: rising-falling swoosh with a thin steel ring
        this.swish({ f1: r(600, 900), f2: r(4200, 5600), f3: r(1600, 2200), dur: r(0.17, 0.23), vol: 0.5 * vol });
        this.swish({ f1: 3000, f2: 9000, f3: 6000, q: 3, dur: 0.12, vol: 0.12 * vol, at: 0.02 });
        this.metal({ f: r(2300, 2700), dur: 0.35, vol: 0.018 * vol, at: 0.03 });
        break;
      case 'cut':
        // blade into titan flesh: crisp bite, wet chop, body thump, then steam
        this.noiseHit({ type: 'highpass', f: 3500, dur: 0.03, vol: 0.45 * vol });
        this.noiseHit({ type: 'bandpass', f: 1100, f2: 220, q: 1.8, dur: 0.24, vol: 0.9 * vol });
        this.noiseHit({ type: 'lowpass', f: 700, f2: 120, dur: 0.3, vol: 0.5 * vol, at: 0.01 });
        this.tone({ type: 'sine', f: 130, f2: 45, dur: 0.3, vol: 0.55 * vol });
        this.steam(0.8, 0.07 * vol, 0.08);
        break;
      case 'nape':
        // the killing cut: deep chop, sub drop, steel ring and a burst of steam
        this.swish({ f1: 500, f2: 5000, f3: 1500, dur: 0.22, vol: 0.55 * vol });
        this.noiseHit({ type: 'highpass', f: 3000, dur: 0.04, vol: 0.55 * vol, at: 0.05 });
        this.noiseHit({ type: 'bandpass', f: 900, f2: 160, q: 1.4, dur: 0.4, vol: 1.1 * vol, at: 0.05 });
        this.tone({ type: 'sine', f: 95, f2: 26, dur: 0.75, vol: 0.85 * vol, at: 0.05 });
        this.tone({ type: 'triangle', f: 190, f2: 50, dur: 0.4, vol: 0.25 * vol, at: 0.05 });
        this.metal({ f: 1318, dur: 1.4, vol: 0.05 * vol, at: 0.07, verb: 0.8 });
        this.steam(1.8, 0.16 * vol, 0.12);
        break;
      case 'clang':
        // steel on hardened skin
        this.metal({ f: r(1500, 1900), dur: 0.7, vol: 0.12 * vol, verb: 0.4 });
        this.noiseHit({ type: 'bandpass', f: 4200, q: 1.5, dur: 0.06, vol: 0.4 * vol });
        this.tone({ type: 'triangle', f: 320, f2: 180, dur: 0.12, vol: 0.12 * vol });
        break;
      case 'step': {
        // titan footfall: sub thump, earthy body, a few pebbles
        const p = r(0.85, 1.15);
        this.tone({ type: 'sine', f: 62 * p, f2: 26, dur: 0.55, vol: 0.7 * vol });
        this.tone({ type: 'triangle', f: 120 * p, f2: 50, dur: 0.18, vol: 0.18 * vol });
        this.noiseHit({ type: 'lowpass', f: 380, f2: 90, dur: 0.4, vol: 0.4 * vol });
        if (vol > 0.3) this.rubble(3, 0.25, 0.08 * vol, 0.03);
        break;
      }
      case 'roar':
        // titan bellow: rising then sagging pitch through an open "aah"
        this.growl({ f0: r(80, 100), f1: r(115, 135), f2: r(55, 70), dur: r(1.4, 1.8), vol: 0.32 * vol, form: [r(480, 560), r(950, 1100), 2300] });
        this.noiseHit({ type: 'lowpass', f: 300, f2: 80, dur: 1.4, vol: 0.12 * vol });
        break;
      case 'grunt':
        // short pain growl when a titan loses a limb or an eye
        this.growl({ f0: r(110, 130), f1: r(95, 110), f2: 70, dur: r(0.35, 0.5), vol: 0.24 * vol, form: [r(400, 460), 820, 2200], rough: 0.6, verb: 0.3 });
        break;
      case 'groan':
        // dying titan: long sinking "ooh" fading into steam
        this.growl({ f0: r(75, 90), f1: r(70, 80), f2: 34, dur: 2.4, vol: 0.28 * vol, form: [330, 680, 2300], rough: 0.55, breath: 0.35, verb: 0.7 });
        this.steam(2.8, 0.1 * vol, 0.4);
        break;
      case 'swipe':
        // a huge arm sweeping through the air
        this.swish({ f1: 140, f2: 620, f3: 200, q: 0.9, dur: r(0.5, 0.65), vol: 0.8 * vol });
        this.noiseHit({ type: 'lowpass', f: 220, dur: 0.5, vol: 0.18 * vol });
        break;
      case 'thud':
        // a titan's body hitting the ground
        this.tone({ type: 'sine', f: 52, f2: 20, dur: 1.1, vol: 0.95 * vol });
        this.noiseHit({ type: 'lowpass', f: 450, f2: 70, dur: 0.9, vol: 0.7 * vol });
        this.rubble(10, 0.9, 0.16 * vol, 0.05);
        this.steam(2.2, 0.08 * vol, 0.1);
        break;
      case 'thunder':
        // transformation lightning: a sharp crack, then a long rolling rumble
        this.noiseHit({ type: 'highpass', f: 2500, dur: 0.08, vol: 0.9 * vol });
        this.noiseHit({ type: 'bandpass', f: 4000, f2: 400, q: 0.7, dur: 0.5, vol: 0.8 * vol, at: 0.02 });
        this.tone({ type: 'sine', f: 70, f2: 24, dur: 1.6, vol: 0.9 * vol, at: 0.05 });
        this.noiseHit({ type: 'lowpass', f: 500, f2: 60, dur: 2.8, vol: 0.7 * vol, at: 0.08 });
        this.noiseHit({ type: 'lowpass', f: 300, f2: 50, dur: 2.2, vol: 0.5 * vol, at: 0.6 });
        this.steam(2.5, 0.22 * vol, 0.15);
        break;
      case 'crumble':
        // stone and timber collapsing
        this.noiseHit({ type: 'lowpass', f: 700, f2: 90, dur: 0.9, vol: 0.55 * vol });
        this.tone({ type: 'sine', f: 48, f2: 24, dur: 0.8, vol: 0.45 * vol });
        this.rubble(12, 0.9, 0.2 * vol, 0.02);
        this.noiseHit({ type: 'bandpass', f: 1400, q: 0.8, dur: 0.12, vol: 0.25 * vol });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', f: 200, f2: 80, dur: 0.25, vol: 0.2 * vol });
        this.noiseHit({ type: 'lowpass', f: 800, dur: 0.2, vol: 0.4 * vol });
        this.tone({ type: 'sine', f: 90, f2: 40, dur: 0.3, vol: 0.4 * vol });
        break;
      case 'supply':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 0.18, vol: 0.12 * vol, at: i * 0.06 }));
        break;
      case 'ui':
        this.tone({ type: 'triangle', f: 660, f2: 880, dur: 0.07, vol: 0.12 * vol });
        break;
      case 'chain':
        this.tone({ type: 'triangle', f: 880, dur: 0.15, vol: 0.12 * vol });
        this.tone({ type: 'triangle', f: 1318, dur: 0.25, vol: 0.1 * vol, at: 0.08 });
        break;
      case 'harden':
        // crystal skin forming: rising shimmer over a stony crackle
        this.tone({ type: 'sine', f: 400, f2: 1600, dur: 0.5, vol: 0.15 * vol, dest: this.verb });
        this.metal({ f: 1046, dur: 0.9, vol: 0.05 * vol, at: 0.35, verb: 0.8 });
        this.rubble(8, 0.45, 0.1 * vol);
        break;
      case 'win':
        [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'sawtooth', f, dur: 0.9, vol: 0.05, at: i * 0.12, dest: this.verb }));
        break;
      case 'lose':
        [392, 311, 261, 196].forEach((f, i) => this.tone({ type: 'sawtooth', f, dur: 0.9, vol: 0.05, at: i * 0.2, dest: this.verb }));
        break;
    }
  }

  setGas(level) { if (this.ctx) this.gasGain.gain.setTargetAtTime(level * 0.22, this.t, 0.05); }
  setWind(speed) {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, (speed - 8) / 35));
    this.windGain.gain.setTargetAtTime(k * 0.35, this.t, 0.1);
    this.windLp.frequency.setTargetAtTime(300 + k * 1400, this.t, 0.1);
  }

  // ---------- music ----------
  // Music priority: a track the player picked from disk (kept in this browser only),
  // then music/theme.mp3 if the site ships one, then the generated score.
  async tryCustomMusic() {
    if (this.userBuf) { this.customBuf = this.userBuf; return true; }
    if (this.customTried) return !!this.customBuf;
    this.customTried = true;
    try {
      const res = await fetch('music/theme.mp3', { cache: 'force-cache' });
      if (!res.ok) return false;
      this.customBuf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      return true;
    } catch (e) { return false; }
  }

  // Player's own track: decoded now, stored in IndexedDB so it survives a reload.
  async setUserTrack(file) {
    const data = await file.arrayBuffer();
    this.userBuf = await this.ctx.decodeAudioData(data.slice(0));
    this.userName = file.name;
    trackStore('put', { data, name: file.name }).catch(() => {});
    this.restartMusic();
  }
  clearUserTrack() {
    this.userBuf = null; this.userName = null;
    this.customBuf = null; this.customTried = false;
    trackStore('delete').catch(() => {});
    this.restartMusic();
  }
  async loadSavedTrack() {
    try {
      const rec = await trackStore('get');
      if (!rec || !rec.data) return;
      this.userBuf = await this.ctx.decodeAudioData(rec.data);
      this.userName = rec.name;
      this.onTrack && this.onTrack();
      this.restartMusic();
    } catch (e) { /* no saved track */ }
  }
  restartMusic() {
    this.onTrack && this.onTrack();
    if (!this.musicOn) return;
    this.stopMusic();
    this.startMusic();
  }

  async startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    if (await this.tryCustomMusic()) {
      if (!this.musicOn || this.customSrc) return;
      this.customSrc = this.ctx.createBufferSource();
      this.customSrc.buffer = this.customBuf; this.customSrc.loop = true;
      this.customSrc.connect(this.music);
      this.customSrc.start();
      return;
    }
    if (!this.musicOn) return;
    this.step = 0;
    this.nextT = this.t + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
    if (this.customSrc) { try { this.customSrc.stop(); } catch (e) { /* stopped */ } this.customSrc = null; }
  }

  // A sung "aah": detuned saws through two vowel formants.
  choir(f, dur, vol, at) {
    const ctx = this.ctx, t = this.t + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.8, dur * 0.35));
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 780; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1180; f2.Q.value = 6;
    f1.connect(g); f2.connect(g);
    g.connect(this.music); g.connect(this.verb);
    for (const d of [-7, 0, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
      const vib = ctx.createOscillator(); vib.frequency.value = 5 + Math.random(); const vg = ctx.createGain(); vg.gain.value = 4;
      vib.connect(vg).connect(o.detune);
      o.connect(f1); o.connect(f2);
      o.start(t); o.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
    }
  }
  // Short bowed string note for the ostinato.
  bow(f, dur, vol, at) {
    const ctx = this.ctx, t = this.t + at;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.01, vol, dur);
    o.connect(lp).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
  taiko(vol, at, f = 62) {
    this.tone({ type: 'sine', f, f2: 34, dur: 0.55, vol, at, dest: this.music });
    this.noiseHit({ type: 'lowpass', f: 420, f2: 120, dur: 0.18, vol: vol * 0.5, at, dest: this.music });
  }

  // Epic minor-key score: choir + string ostinato always; brass, taiko and snare join as the fight heats up.
  schedule() {
    const bpm = 128, spb = 60 / bpm / 4; // sixteenth notes
    // D minor: Dm - Bb - F - C | Dm - Bb - Gm - A
    const prog = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const ost = [0, 12, 7, 12, 0, 12, 7, 15, 0, 12, 7, 12, 3, 12, 7, 12];
    while (this.nextT < this.t + 0.15) {
      const s = this.step, bar = Math.floor(s / 16) % prog.length, n = s % 16, t = this.nextT - this.t;
      const ch = prog[bar], I = this.intensity, root = ch[0];
      if (n === 0) {
        for (const m of ch) this.choir(mtof(m + 12), spb * 16, 0.022 + I * 0.012, t);
        this.tone({ type: 'sawtooth', f: mtof(root - 24), dur: spb * 15, vol: 0.06 + I * 0.05, a: 0.05, at: t, dest: this.music });
      }
      // string ostinato
      this.bow(mtof(root + ost[n]), spb * 0.9, 0.028 + I * 0.025, t);
      // brass stabs on the off-beats once things get going
      if (I > 0.35 && (n === 0 || n === 6 || n === 12)) for (const m of ch) this.tone({ type: 'sawtooth', f: mtof(m), dur: spb * 2.5, vol: 0.02 + I * 0.02, a: 0.02, at: t, dest: this.music });
      // taiko pattern
      const tk = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0][n];
      if (tk && (I > 0.15 || n === 0)) this.taiko(0.32 * (0.35 + I * 0.65), t, n === 0 ? 58 : 66);
      if (I > 0.45 && (n === 4 || n === 12)) this.noiseHit({ type: 'bandpass', f: 1700, dur: 0.16, vol: 0.16 * I, at: t, dest: this.music });
      if (I > 0.75 && n % 2 === 1) this.noiseHit({ type: 'highpass', f: 8000, dur: 0.03, vol: 0.05, at: t, dest: this.music });
      // timpani roll into every 4th bar
      if (bar % 4 === 3 && n >= 12) this.taiko(0.1 + 0.05 * (n - 12), t, 90);
      this.step++;
      this.nextT += spb;
    }
  }
}

// One-record IndexedDB store for the player's music file.
function trackStore(op, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shingekicraft', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('music');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('music', op === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore('music');
      const r = op === 'get' ? st.get('track') : op === 'put' ? st.put(value, 'track') : st.delete('track');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    };
  });
}

export const audio = new Audio();
