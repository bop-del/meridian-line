// ctx.audio: procedural WebAudio engine (sfx, engine ambience, music).
// API: audio.setIntensity(0..1) to override music intensity,
// audio.stopMusic(fade), audio.getVolumes(). sfx names also accept 'uiBack' (alias of uiMove, lower pitch).
// Sounds triggered by game events are deduped against direct audio.sfx() calls (same name or same
// group within ~60ms and rate limited per name), so callers may use either or both.
import { SFX, SFX_META } from './sfx.js';
import { MusicEngine } from './music.js';
import { selectedTitleVariant, saveTitleVariant, titleVariantList } from './title/registry.js';
import { getNoise } from './synth.js';

const MAX_VOICES = 30;
const DEFAULT_META = { gap: 0.04, max: 4, prio: 2 };
const LEVEL_MUSIC = ['thalassa', 'cinder', 'foundry'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const audio = {
  ctx: null,
  ac: null,
  gesture: false,
  vol: { master: 0.8, music: 0.6, sfx: 0.9 },
  last: {},
  lastAny: {},
  active: {},
  activeTotal: 0,
  wantMusic: null,
  paused: false,
  engineIn: { speed: 0.4, boost: false, at: -99 },
  cellStreak: { n: 0, at: -9, pitch: 1 },
  lockStreak: { n: 0, at: -9 },
  phase: null,
  hooked: false,
  intensityOverride: null,
  _resumeAt: 0,

  init(ctx) {
    this.ctx = ctx;
    if (!this.hooked) {
      this.hooked = true;
      const unlock = () => {
        this.unlock();
        if (this.ac && this.ac.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) window.removeEventListener(ev, unlock, true);
      };
      for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, unlock, true);
      this.subscribe(ctx.events);
    }
  },

  reset() {
    this.last = {}; this.lastAny = {}; this.cellStreak.n = 0; this.lockStreak.n = 0;
  },

  // ==== context and graph
  ensure() {
    if (this.ac) return true;
    if (!this.gesture) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    let ac;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    this.ac = ac;
    this.buildGraph(ac);
    this.applyVolumes(true);
    this.music_ = new MusicEngine(ac, this.musicLP);
    this.startEngine();
    ac.addEventListener?.('statechange', () => { if (ac.state === 'running') this.flushPending(); });
    return true;
  },

  buildGraph(ac) {
    this.sfxIn = ac.createGain();
    this.musicIn = ac.createGain();
    this.musicLP = ac.createBiquadFilter();
    this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 20000; this.musicLP.Q.value = 0.5;
    this.musicLP.connect(this.musicIn);
    this.mix = ac.createGain();
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.master = ac.createGain();
    this.sfxIn.connect(this.mix); this.musicIn.connect(this.mix);
    this.mix.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(this.master); this.master.connect(ac.destination);
    this.duck = 1;
  },

  applyVolumes(immediate) {
    if (!this.ac) return;
    const t = this.ac.currentTime, k = immediate ? 0.001 : 0.04;
    this.master.gain.setTargetAtTime(this.vol.master, t, k);
    this.sfxIn.gain.setTargetAtTime(this.vol.sfx, t, k);
    this.musicIn.gain.setTargetAtTime(this.vol.music * 0.85 * this.duck, t, k);
  },

  unlock() {
    this.gesture = true;
    if (!this.ensure()) return;
    if (this.ac.state !== 'running') this.ac.resume().then(() => this.flushPending()).catch(() => {});
    else this.flushPending();
  },

  flushPending() {
    if (this.wantMusic && this.music_ && !this.music_.curName) this.music_.play(this.wantMusic, { fade: 0.5 });
  },

  // ==== public API
  sfx(name, opts = {}) {
    if (name === 'uiBack') { name = 'uiMove'; opts = { ...opts, pitch: (opts.pitch || 1) * 0.7 }; }
    const def = SFX[name];
    if (!def) return null;
    if (!this.ensure()) return null;
    const ac = this.ac;
    if (ac.state === 'suspended') { const n = performance.now(); if (n - this._resumeAt > 1000) { this._resumeAt = n; ac.resume().catch(() => {}); } return null; }
    const meta = SFX_META[name] || DEFAULT_META;
    const now = performance.now() / 1000;
    if (now - (this.last[name] ?? -9) < meta.gap) return null;
    if ((this.active[name] || 0) >= meta.max) return null;
    if (this.activeTotal >= MAX_VOICES && meta.prio < 3) return null;
    this.last[name] = now;
    this.lastAny[meta.group || name] = now;

    // spatialisation relative to the camera
    let gain = 1, pan = 0;
    if (opts.position) ({ gain, pan } = this.spatial(opts.position));
    gain *= meta.gain ?? 1;
    const vg = ac.createGain();
    vg.gain.value = gain;
    let tail = vg;
    let panner = null;
    if (ac.createStereoPanner) {
      panner = ac.createStereoPanner(); panner.pan.value = pan;
      vg.connect(panner); tail = panner;
    }
    tail.connect(this.sfxIn);
    const env = { ac, out: vg, t: ac.currentTime + 0.005, v: opts.volume ?? 1, p: opts.pitch ?? 1, r: Math.random };
    const dur = def(env);
    this.active[name] = (this.active[name] || 0) + 1;
    this.activeTotal++;
    setTimeout(() => {
      this.active[name] -= 1; this.activeTotal -= 1;
      try { vg.disconnect(); panner?.disconnect(); } catch (e) { /* ignore */ }
    }, (dur + 0.3) * 1000);
    return dur;
  },

  spatial(pos) {
    const cam = this.ctx?.camera;
    if (!cam || pos.x === undefined) return { gain: 1, pan: 0 };
    const e = cam.matrixWorld.elements;
    const dx = pos.x - e[12], dy = pos.y - e[13], dz = pos.z - e[14];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const x = dx * e[0] + dy * e[1] + dz * e[2];
    const fwd = -(dx * e[8] + dy * e[9] + dz * e[10]);
    const pan = clamp(x / Math.max(8, dist * 0.7), -1, 1) * 0.85;
    let gain = Math.max(0.12, 1 / (1 + dist / 70));
    if (fwd < 0) gain *= 0.7;
    return { gain, pan: Number.isFinite(pan) ? pan : 0 };
  },

  music(name) {
    this.wantMusic = name;
    if (!name) { this.music_?.stop(); return; }
    if (!this.ensure()) return;
    if (!this.music_.has(name)) return;
    this.music_.play(name, { fade: name === 'boss' ? 0.5 : name === 'gameover' ? 0.4 : 1.3 });
  },

  // Title music variants (B default, A and C selectable). See src/audio/title/registry.js.
  titleVariants() { return titleVariantList(); },
  getTitleVariant() { return selectedTitleVariant(); },
  setTitleVariant(id) {
    saveTitleVariant(id);
    if (this.wantMusic === 'title' && this.ensure()) this.music_.play('title', { fade: 0.8, variant: id });
  },

  stopMusic(fade = 1) { this.wantMusic = null; this.music_?.stop(fade); },

  pauseMusic(paused) {
    this.paused = !!paused;
    this.duck = paused ? 0.4 : 1;
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.musicLP.frequency.setTargetAtTime(paused ? 650 : 20000, t, 0.08);
    this.applyVolumes(false);
  },

  setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx']) if (typeof v[k] === 'number') this.vol[k] = clamp(v[k], 0, 1);
    this.applyVolumes(false);
  },

  getVolumes() { return { ...this.vol }; },

  setEngine(speed01, boosting = false) {
    this.engineIn.speed = clamp(speed01 ?? 0.4, 0, 1);
    this.engineIn.boost = !!boosting;
    this.engineIn.at = performance.now() / 1000;
  },

  setIntensity(x) { this.intensityOverride = x == null ? null : clamp(x, 0, 1); },

  // ==== engine loop ambience
  startEngine() {
    const ac = this.ac;
    const out = (this.engGain = ac.createGain());
    out.gain.value = 0;
    out.connect(this.sfxIn);
    this.engOsc = ac.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 60;
    this.engSub = ac.createOscillator(); this.engSub.type = 'sine'; this.engSub.frequency.value = 30;
    this.engLP = ac.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 260; this.engLP.Q.value = 2;
    const oscGain = ac.createGain(); oscGain.gain.value = 0.035;
    const subGain = ac.createGain(); subGain.gain.value = 0.04;
    this.engOsc.connect(this.engLP); this.engLP.connect(oscGain); oscGain.connect(out);
    this.engSub.connect(subGain); subGain.connect(out);
    const src = ac.createBufferSource(); src.buffer = getNoise(ac).brown; src.loop = true;
    this.engBP = ac.createBiquadFilter(); this.engBP.type = 'bandpass'; this.engBP.frequency.value = 700; this.engBP.Q.value = 0.7;
    this.engNoise = ac.createGain(); this.engNoise.gain.value = 0.02;
    src.connect(this.engBP); this.engBP.connect(this.engNoise); this.engNoise.connect(out);
    this.engOsc.start(); this.engSub.start(); src.start();
  },

  updateEngine(ctx) {
    if (!this.ac || !this.engGain) return;
    const t = this.ac.currentTime;
    const playing = ctx.state.phase === 'playing' && this.ac.state === 'running';
    let speed = this.engineIn.speed, boost = this.engineIn.boost;
    if (performance.now() / 1000 - this.engineIn.at > 0.5) {
      const c = ctx.config?.rail;
      if (ctx.rail && c) speed = clamp((ctx.rail.speed - c.brakeSpeed) / (c.boostSpeed - c.brakeSpeed), 0, 1);
      boost = !!ctx.player?.isBoosting;
    }
    this.engGain.gain.setTargetAtTime(playing ? 0.6 : 0, t, playing ? 0.4 : 0.15);
    this.engOsc.frequency.setTargetAtTime(48 + speed * 34 + (boost ? 26 : 0), t, 0.15);
    this.engSub.frequency.setTargetAtTime(24 + speed * 17 + (boost ? 13 : 0), t, 0.15);
    this.engLP.frequency.setTargetAtTime(220 + speed * 260 + (boost ? 500 : 0), t, 0.2);
    this.engBP.frequency.setTargetAtTime(420 + speed * 700 + (boost ? 1500 : 0), t, 0.2);
    this.engNoise.gain.setTargetAtTime(0.02 + speed * 0.03 + (boost ? 0.07 : 0), t, 0.2);
  },

  // ==== per frame
  update(dt, ctx) {
    if (!this.ac) return;
    this.updateEngine(ctx);
    const st = ctx.state;
    // music intensity follows level progress, boss fights are full intensity
    let target = this.intensityOverride;
    if (target == null) target = st.boss ? 1 : 0.35 + 0.65 * clamp(ctx.world?.progress || 0, 0, 1);
    this.music_.setIntensity(target);
    if (st.phase !== this.phase) {
      const prev = this.phase;
      this.phase = st.phase;
      if (st.phase === 'paused') this.pauseMusic(true);
      else if (prev === 'paused') this.pauseMusic(false);
    }
  },

  // ==== event driven sounds
  auto(name, opts) {
    const stamp = performance.now() / 1000;
    const group = (SFX_META[name] || DEFAULT_META).group || name;
    setTimeout(() => {
      // a direct audio.sfx() call for the same group (before or after the event) wins
      if ((this.lastAny[group] ?? -9) > stamp - 0.06) return;
      this.sfx(name, opts);
    }, 0);
  },

  subscribe(ev) {
    const on = (n, f) => ev.on(n, f);
    const pos = (p) => p?.position || p?.enemy?.position || undefined;
    on('player:fire', (p) => this.auto(p?.charged || p?.homing ? 'chargedShot' : 'laser'));
    on('player:lockon', () => {
      const now = performance.now() / 1000;
      const s = this.lockStreak;
      s.n = now - s.at < 0.8 ? Math.min(s.n + 1, 7) : 0;
      s.at = now;
      this.auto('lockon', { pitch: Math.pow(2, (s.n * 2) / 12) });
    });
    on('player:damage', () => this.auto('damage'));
    on('player:dead', () => this.auto('bigExplosion'));
    on('player:bomb', () => this.auto('bomb'));
    on('player:boost', (p) => { if (p?.on !== false) this.auto('boost'); });
    on('player:roll', () => this.auto('roll'));
    on('enemy:killed', (p) => {
      const e = p?.enemy;
      const big = e?.isBoss || (p?.points ?? 0) >= 1000 || (e?.radius ?? 0) >= 3.5;
      this.auto(big ? 'bigExplosion' : 'explosion', { position: pos(p), pitch: big ? 1 : 0.85 + Math.random() * 0.3 });
    });
    on('enemy:hit', (p) => {
      const e = p?.enemy;
      const boss = e?.isBoss || (e && this.ctx?.enemies?.boss === e);
      this.auto(boss ? 'bossHit' : 'hit', { position: pos(p) });
    });
    const cellPitch = () => {
      const now = performance.now() / 1000, r = this.cellStreak;
      if (now - r.at < 0.05) return r.pitch;
      r.n = now - r.at < 1.4 ? Math.min(r.n + 1, 8) : 0;
      r.at = now; r.pitch = Math.pow(2, (r.n * 2) / 12);
      return r.pitch;
    };
    on('pickup:collected', (p) => {
      if (p?.kind === 'shieldCell' || p?.kind === 'capacitor') this.auto('cell', { pitch: cellPitch() });
      else this.auto('pickup');
    });
    on('cell:collected', () => this.auto('cell', { pitch: cellPitch() }));
    on('warning', () => this.auto('warning'));
    on('boss:spawn', () => { this.auto('warning'); this.music('boss'); });
    on('boss:phase', () => this.auto('bossHit', { volume: 1.2, pitch: 0.7 }));
    on('boss:defeated', () => {
      this.auto('bigExplosion');
      setTimeout(() => { if (this.ctx.state.phase !== 'gameover' && this.ctx.state.phase !== 'title') this.music('victory'); }, 1400);
    });
    on('level:start', (p) => {
      const info = this.ctx.world?.levelInfo;
      const idx = p?.index ?? this.ctx.state.levelIndex ?? 0;
      if (this.music_) this.music_.intensity = 0.35;
      this.music(info?.music || LEVEL_MUSIC[idx] || 'thalassa');
    });
    on('game:over', () => this.music('gameover'));
    on('game:victory', () => this.music('victory'));
    on('ally:down', () => this.auto('comm', { pitch: 0.7 }));
  },
};
