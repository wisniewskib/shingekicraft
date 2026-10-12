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
    const ctx = (this.ctx = new AC());
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

  play(name, vol = 1) {
    if (!this.ctx || !this.enabled || !(vol > 0.01)) return;
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
        this.noiseHit({ type: 'highpass', f: 6000, f2: 1500, dur: 0.16, vol: 0.4 * vol });
        this.tone({ type: 'sawtooth', f: 2600, f2: 1800, dur: 0.08, vol: 0.03 * vol });
        break;
      case 'cut':
        this.noiseHit({ type: 'lowpass', f: 1200, f2: 200, dur: 0.35, vol: 0.7 * vol });
        this.tone({ type: 'sine', f: 140, f2: 40, dur: 0.4, vol: 0.6 * vol });
        this.tone({ type: 'triangle', f: 1318, dur: 0.6, vol: 0.08 * vol, at: 0.05, dest: this.verb });
        this.tone({ type: 'triangle', f: 1760, dur: 0.6, vol: 0.06 * vol, at: 0.1, dest: this.verb });
        break;
      case 'clang':
        this.tone({ type: 'square', f: 1900, f2: 1700, dur: 0.15, vol: 0.06 * vol });
        this.noiseHit({ type: 'bandpass', f: 4000, dur: 0.1, vol: 0.3 * vol });
        break;
      case 'step':
        this.tone({ type: 'sine', f: 70, f2: 35, dur: 0.35, vol: 0.5 * vol });
        this.noiseHit({ type: 'lowpass', f: 300, dur: 0.25, vol: 0.25 * vol });
        break;
      case 'roar':
        this.tone({ type: 'sawtooth', f: 110, f2: 60, dur: 1.3, vol: 0.12 * vol, a: 0.15 });
        this.tone({ type: 'sawtooth', f: 116, f2: 64, dur: 1.3, vol: 0.1 * vol, a: 0.15 });
        this.noiseHit({ type: 'lowpass', f: 600, f2: 200, dur: 1.2, vol: 0.18 * vol });
        break;
      case 'crumble':
        this.noiseHit({ type: 'lowpass', f: 900, f2: 120, dur: 0.6, vol: 0.55 * vol });
        this.tone({ type: 'sine', f: 60, f2: 30, dur: 0.5, vol: 0.4 * vol });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', f: 200, f2: 80, dur: 0.25, vol: 0.2 * vol });
        this.noiseHit({ type: 'lowpass', f: 800, dur: 0.2, vol: 0.4 * vol });
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
        this.tone({ type: 'sine', f: 400, f2: 1600, dur: 0.5, vol: 0.15 * vol, dest: this.verb });
        this.noiseHit({ type: 'bandpass', f: 5000, dur: 0.4, vol: 0.2 * vol });
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
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextT = this.t + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() { this.musicOn = false; clearInterval(this.timer); }

  schedule() {
    const spb = 60 / 96 / 2; // eighth notes at 96 bpm
    // D minor: Dm - Bb - F - C
    const chords = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextT < this.t + 0.15) {
      const s = this.step, bar = Math.floor(s / 8) % 4, beat = s % 8, t = this.nextT - this.t;
      const ch = chords[bar];
      const I = this.intensity;
      if (beat === 0) for (const n of ch) {
        this.tone({ type: 'sawtooth', f: mtof(n), dur: spb * 8, vol: 0.035, a: 0.4, at: t, dest: this.music });
        this.tone({ type: 'sawtooth', f: mtof(n) * 1.005, dur: spb * 8, vol: 0.025, a: 0.4, at: t, dest: this.verb });
      }
      if (beat % 2 === 0 || I > 0.5) this.tone({ type: 'triangle', f: mtof(ch[0] - 12), dur: spb * 0.9, vol: 0.16 + I * 0.08, at: t, dest: this.music });
      if (I > 0.2) {
        const arp = [0, 1, 2, 1, 0, 2, 1, 2][beat];
        this.tone({ type: 'square', f: mtof(ch[arp] + 12), dur: spb * 0.6, vol: 0.02 + I * 0.02, at: t, dest: this.music });
      }
      if (beat === 0 || beat === 4 || (I > 0.6 && beat === 6)) this.tone({ type: 'sine', f: 110, f2: 38, dur: 0.3, vol: 0.4 * (0.4 + I * 0.6), at: t, dest: this.music });
      if (I > 0.35 && (beat === 2 || beat === 6)) this.noiseHit({ type: 'bandpass', f: 1800, dur: 0.14, vol: 0.18 * I, at: t, dest: this.music });
      if (I > 0.8 && beat % 2 === 1) this.noiseHit({ type: 'highpass', f: 8000, dur: 0.04, vol: 0.06, at: t, dest: this.music });
      if (s % 64 === 56) this.tone({ type: 'sine', f: 80, f2: 50, dur: 1.2, vol: 0.25, at: t, dest: this.verb });
      this.step++;
      this.nextT += spb;
    }
  }
}

export const audio = new Audio();
