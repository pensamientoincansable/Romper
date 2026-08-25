// Audio 100 % procedural con WebAudio — sin archivos externos.
// SFX sintetizados + música ambiental generativa que cambia de tonalidad por sección.

import { PENTA } from './themes.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.muted = false;
    this._noiseBuf = null;
    this._music = null;
    this._pluckTimer = null;
    this._padOscs = [];
    this._scaleRoot = 220;
    this._inited = false;
  }

  init() {
    if (this._inited) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    // buffer de ruido blanco reutilizable
    const len = this.ctx.sampleRate * 1.2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startMusic();
    this._inited = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setTheme(rootHz) {
    this._scaleRoot = rootHz;
    if (!this._music) return;
    this._music.root = rootHz;
    // El pad abandona la nota anterior suavemente
    const t = this.ctx.currentTime;
    for (const g of this._padGains) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.06, t, 0.9);
    }
  }

  // ---------------- utilidades ----------------
  _env(g, t0, a, peak, d, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustain), t0 + a + d);
  }

  _noise(t0, dur, filterType, freq, q, peak, pan = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxBus);
    this._env(g, t0, 0.004, peak, dur);
    src.start(t0, Math.random() * 0.4, dur + 0.1);
    src.stop(t0 + dur + 0.15);
  }

  _tone(freq, t0, dur, type, peak, pan = 0, bus = null, slideTo = null) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(bus || this.sfxBus);
    this._env(g, t0, 0.006, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  // ---------------- SFX ----------------
  shoot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.07, 'bandpass', 2600 + Math.random() * 700, 1.6, 0.5);
    this._tone(880, t, 0.09, 'sine', 0.34, (Math.random() * 0.5 - 0.25), this.sfxBus, 180);
  }

  shatter(power = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1.8, 0.7 + power * 0.6);
    this._noise(t, 0.16 * k, 'highpass', 2400, 0.7, 0.55 * k);
    this._noise(t, 0.22 * k, 'bandpass', 6200, 2.5, 0.4 * k, 0.2);
    const n = 5 + Math.floor(power * 7);
    for (let i = 0; i < n; i++) {
      const f = 2200 + Math.random() * 5200;
      const d = 0.05 + Math.random() * 0.09;
      this._tone(f, t + Math.random() * 0.05, d, 'triangle', 0.05 + Math.random() * 0.05, Math.random() * 1.2 - 0.6);
    }
    this._tone(140, t, 0.1, 'sine', 0.3, 0, this.sfxBus, 60);
  }

  metalBounce() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(640, t, 0.12, 'triangle', 0.4, 0, this.sfxBus, 200);
    this._tone(1305, t, 0.06, 'square', 0.07, 0.25, this.sfxBus, 500);
    this._noise(t, 0.05, 'highpass', 4000, 1, 0.25);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = this._scaleRoot;
    this._tone(base * 2, t, 0.12, 'sine', 0.35);
    this._tone(base * 3, t + 0.07, 0.16, 'sine', 0.35);
    this._tone(base * 4, t + 0.14, 0.24, 'triangle', 0.22);
  }

  perfect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const root = this._scaleRoot;
    const seq = [2, 3, 4, 5.33];
    seq.forEach((m, i) => {
      this._tone(root * m, t + i * 0.07, 0.3, 'sine', 0.3);
      this._tone(root * m * 1.006, t + i * 0.07, 0.28, 'triangle', 0.08);
    });
  }

  checkpoint() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const root = this._scaleRoot;
    [1, 1.5, 2, 3].forEach((m, i) => {
      this._tone(root * m, t + i * 0.28, 1.6, 'sine', 0.16, (i % 2 ? 0.3 : -0.3), this.musicBus);
    });
  }

  damage() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(110, t, 0.4, 'sawtooth', 0.5, 0, this.sfxBus, 45);
    this._noise(t, 0.34, 'lowpass', 900, 1.2, 0.55);
  }

  click() {
    if (!this.ctx) return;
    this._tone(660, this.ctx.currentTime, 0.06, 'sine', 0.18, 0, this.sfxBus, 330);
  }

  gameOver() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seq = [1, 0.75, 0.5, 0.4];
    seq.forEach((m, i) => this._tone(220 * m, t + i * 0.22, 0.6, 'sine', 0.3, 0, this.sfxBus, 220 * m * 0.7));
  }

  start() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const root = this._scaleRoot;
    [1, 1.25, 1.5, 2].forEach((m, i) => this._tone(root * m, t + i * 0.09, 0.5, 'sine', 0.22));
  }

  // ---------------- música ambiental generativa ----------------
  _startMusic() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Pad: 2 osciladores desafinados + filtro + LFO suave
    this._padGains = [];
    const p1 = ctx.createOscillator(); p1.type = 'sawtooth'; p1.frequency.value = 110;
    const p2 = ctx.createOscillator(); p2.type = 'sawtooth'; p2.frequency.value = 110 * 1.007;
    const p3 = ctx.createOscillator(); p3.type = 'sine'; p3.frequency.value = 110 * 2.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.28;
    lfo.connect(lfoGain); lfoGain.connect(p1.frequency); lfoGain.connect(p2.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 1.2;
    const padGain = ctx.createGain(); padGain.gain.value = 0.10;
    p1.connect(lp); p2.connect(lp); p3.connect(lp);
    const lpWet = ctx.createGain(); lpWet.gain.value = 1;
    lp.connect(lpWet); lpWet.connect(padGain); padGain.connect(this.musicBus);
    p1.start(); p2.start(); p3.start(); lfo.start();
    this._padGains.push(padGain, lpWet);

    // Punteos pentatónicos aleatorios + eco
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    delay.connect(fb); fb.connect(delay);
    const delayOut = ctx.createGain(); delayOut.gain.value = 0.55;
    delay.connect(delayOut); delayOut.connect(this.musicBus);
    this._pluckBus = ctx.createGain();
    this._pluckBus.connect(this.musicBus);
    this._pluckBus.connect(delay);

    const playPluck = () => {
      if (!this.ctx) return;
      const now = ctx.currentTime;
      const oct = Math.random() < 0.35 ? 2 : 1;
      const deg = PENTA[Math.floor(Math.random() * PENTA.length)];
      const f = this._scaleRoot * oct * Math.pow(2, deg / 12);
      const o = ctx.createOscillator(); o.type = Math.random() < 0.75 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g); g.connect(this._pluckBus);
      this._env(g, now, 0.01, 0.10 + Math.random() * 0.08, 1.4);
      o.start(now); o.stop(now + 1.6);
      const next = 0.7 + Math.random() * 1.9;
      this._pluckTimer = setTimeout(playPluck, next * 1000);
    };
    this._padOscs = [p1, p2, p3, lfo];
    this._pluckTimer = setTimeout(playPluck, 900);
  }

  stopMusic() {
    if (this._pluckTimer) clearTimeout(this._pluckTimer);
    this._pluckTimer = null;
  }

  // reanuda los punteos ambientales si se detuvieron (pausa)
  resumeMusic() {
    if (!this.ctx || this._pluckTimer) return;
    const ctx = this.ctx;
    const playPluck = () => {
      if (!this.ctx) return;
      const now = ctx.currentTime;
      const oct = Math.random() < 0.35 ? 2 : 1;
      const deg = PENTA[Math.floor(Math.random() * PENTA.length)];
      const f = this._scaleRoot * oct * Math.pow(2, deg / 12);
      const o = ctx.createOscillator(); o.type = Math.random() < 0.75 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      o.connect(g); g.connect(this._pluckBus);
      this._env(g, now, 0.01, 0.10 + Math.random() * 0.08, 1.4);
      o.start(now); o.stop(now + 1.6);
      this._pluckTimer = setTimeout(playPluck, (0.7 + Math.random() * 1.9) * 1000);
    };
    this._pluckTimer = setTimeout(playPluck, 500);
  }
}
