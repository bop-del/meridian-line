// ctx.audio: procedural WebAudio engine (sfx, engine ambience, music).
// API: audio.setIntensity(0..1) to override music intensity,
// audio.stopMusic(fade), audio.getVolumes(). sfx names also accept 'uiBack' (alias of uiMove, lower pitch).
// Music style (the whole game's music follows it): audio.musicStyles() -> [{id, name}], audio.getMusicStyle(),
// audio.setMusicStyle(id) (persists, applies live, emits 'audio:style' {id}). Old aliases: titleVariants(),
// getTitleVariant(), setTitleVariant(id).
// Unlock: audio.unlocked (bool), audio.unlock() (call from a user gesture), event 'audio:unlocked' fires once. Window listeners
// (pointerdown/up, touchstart/end, click, keydown) stay armed until the context runs and are re-armed when it is suspended or
// interrupted. Phones: navigator.audioSession.type = 'playback' before the context exists, the context is suspended while the page
// is hidden, and a context that stays out of 'running' for ~0.8 s mid run pauses the game ('ui:pause'). audio.diagLine() feeds ?phonediag=1.
// Debug: audio.debug() -> {style, track, playing, intensity, loop, ...}, audio.stats() -> {duck, spatial, voices, engineNodes, ...}.
// Audio depth: mix.js (buses, master chain, music ducking), spatial.js (pooled PannerNode slots for sfx with a `position`
// option), engine.js (the continuous engine voice), voice.js (pilot voice barks and data blips tied to comm lines). Values live in
// the feel group `audio` (src/feel/audio.js). audio.duck(reason, opts) and audio.mix are available to other modules.
// Sounds triggered by game events are deduped against direct audio.sfx() calls (same name or same
// group within ~60ms and rate limited per name), so callers may use either or both.
import { SFX, SFX_META } from './sfx.js';
import { MusicEngine } from './music.js';
import { selectedStyle, saveStyle, styleList } from './styles/registry.js';
import { feel } from '../core/feel.js';
import { Mix } from './mix.js';
import { Spatial } from './spatial.js';
import { Engine } from './engine.js';
import { Voice } from './voice.js';
import { device } from '../core/device.js';

// Phones get a smaller voice budget (20 instead of 30): less mixing work on the audio thread, and the dropped voices are the
// low priority repeats (prio below 3), so warnings, bombs and explosions still always play.
const MAX_VOICES = device.touch ? 20 : 30;
// Events that count as a user gesture somewhere. iOS Safari accepts touchend, pointerup, click and keydown for resume(), not
// pointerdown or touchstart, so all of them are listened for and the listeners stay until the context really runs.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'];
// Phones only: how long the context may stay out of 'running' while the game is playing before the game pauses itself.
const STALL_PAUSE_S = 0.8;
const DEFAULT_META = { gap: 0.04, max: 4, prio: 2 };
const LEVEL_MUSIC = ['foundry', 'cinder', 'thalassa'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Clamps every BiquadFilter frequency (value setter and automation calls) to sampleRate / 2 so that low sample rate
 * devices do not log range warnings for filters tuned for 44.1 kHz and up. Call once per context before building nodes.
 */
export function clampBiquads(ac) {
  if (!ac || ac.__biquadClamp || typeof ac.createBiquadFilter !== 'function' || typeof AudioParam === 'undefined') return;
  ac.__biquadClamp = true;
  const make = ac.createBiquadFilter.bind(ac);
  const cl = (v) => (typeof v === 'number' && v > ac.sampleRate / 2 ? ac.sampleRate / 2 : v);
  const valueDesc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  ac.createBiquadFilter = function createBiquadFilter() {
    const f = make();
    const p = f.frequency;
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      const orig = p[m].bind(p);
      p[m] = (v, ...rest) => orig(cl(v), ...rest);
    }
    if (valueDesc && valueDesc.get && valueDesc.set) {
      Object.defineProperty(p, 'value', { configurable: true, get() { return valueDesc.get.call(p); }, set(v) { valueDesc.set.call(p, cl(v)); } });
    }
    return f;
  };
}

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
  unlocked: false,
  _style: null,
  intensityOverride: null,
  _resumeAt: 0,
  lastUnlockEvent: 'none',   // name of the last gesture event that tried to unlock the context (phonediag)
  audioSessionType: 'n/a',   // navigator.audioSession.type after we set it, or n/a where the API does not exist
  _armed: false,
  _stallSince: 0,

  init(ctx) {
    this.ctx = ctx;
    if (!this.hooked) {
      this.hooked = true;
      this._onGesture = (e) => {
        this.lastUnlockEvent = e.type;
        this.unlock();
        // listeners go away only once the context is running; if it is interrupted or suspended later they are armed again
        if (this.ac && this.ac.state === 'running') this.disarmUnlock();
      };
      this.armUnlock();
      document.addEventListener('visibilitychange', () => this.onVisibility());
      this.subscribe(ctx.events);
    }
  },

  armUnlock() {
    if (this._armed) return;
    this._armed = true;
    for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, this._onGesture, true);
  },

  disarmUnlock() {
    if (!this._armed) return;
    this._armed = false;
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this._onGesture, true);
  },

  /** Page hidden or shown. On phones the context is suspended while hidden (iOS may otherwise keep playing under the 'playback' session) and resumed when visible. */
  onVisibility() {
    const ac = this.ac;
    if (!ac) return;
    if (document.hidden) {
      if (device.touch && ac.state === 'running') ac.suspend().catch(() => {});
      return;
    }
    this.retryResume();
  },

  /** Try to bring the context back without a gesture (works after a short interruption, fails until a tap otherwise) and keep the gesture listeners armed. */
  retryResume() {
    const ac = this.ac;
    if (!ac || ac.state === 'running') return;
    this.lastUnlockEvent = 'retry';
    this.armUnlock();
    ac.resume().catch(() => {});
  },

  /** One-line state for the ?phonediag=1 overlay. */
  diagLine() {
    const ac = this.ac;
    return `${ac ? ac.state : 'none'} ${ac ? ac.sampleRate : '-'}Hz session=${this.audioSessionType} last=${this.lastUnlockEvent}`;
  },

  reset() {
    this.last = {}; this.lastAny = {}; this.cellStreak.n = 0; this.lockStreak.n = 0;
    this.mix?.ducks.clear();
    if (this.mix) this.mix.tick();
  },

  // ==== context and graph
  ensure() {
    if (this.ac) return true;
    if (!this.gesture) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // iOS 17 and later: 'playback' keeps the game audible with the ringer switch on silent. Must be set before the context exists.
    try {
      const as = navigator.audioSession;
      if (as && (device.touch || device.ios)) { as.type = 'playback'; this.audioSessionType = as.type; }
      else if (as) this.audioSessionType = as.type;
    } catch (e) { /* unsupported value or API */ }
    let ac;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    this.ac = ac;
    clampBiquads(ac);
    this.buildGraph(ac);
    this.applyVolumes(true);
    this.music_ = new MusicEngine(ac, this.musicLP, { styleId: this.getMusicStyle() });
    this.eng = new Engine(ac, this.mix.engine);
    this.voice = new Voice(ac, this.mix.voice);
    ac.addEventListener?.('statechange', () => {
      if (ac.state === 'running') { this.markUnlocked(); this.disarmUnlock(); this._stallSince = 0; }
      else { this.armUnlock(); if (!document.hidden) this.retryResume(); }
    });
    return true;
  },

  buildGraph(ac) {
    const mix = (this.mix = new Mix(ac, { vol: this.vol }));
    this.sfxIn = mix.sfx; this.musicIn = mix.music;
    this.comp = mix.comp; this.limiter = mix.limiter; this.master = mix.master;
    this.musicLP = ac.createBiquadFilter();
    this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 20000; this.musicLP.Q.value = 0.5;
    this.musicLP.connect(mix.music);
    this.spat = new Spatial(ac, mix.sfx);
    this.duck = 1;
  },

  applyVolumes(immediate) {
    if (!this.ac || !this.mix) return;
    this.mix.vol.master = this.vol.master; this.mix.vol.music = this.vol.music; this.mix.vol.sfx = this.vol.sfx;
    this.mix.pause = this.duck;
    this.mix.applyLevels(immediate);
  },

  /** Call from a user gesture (the window listeners do it on the first key or click). Resolves to audio.unlocked. */
  unlock() {
    this.gesture = true;
    if (!this.ensure()) return Promise.resolve(false);
    if (this.ac.state === 'running') { this.markUnlocked(); return Promise.resolve(true); }
    this.kick();
    return this.ac.resume().then(() => { if (this.ac.state === 'running') this.markUnlocked(); return this.unlocked; }).catch(() => false);
  },

  /** Older iOS only starts output once something was played inside the gesture: a one sample silent buffer does it. Harmless elsewhere. */
  kick() {
    try {
      const ac = this.ac;
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
      src.connect(ac.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
  },

  /** The context is running after a gesture: start the remembered music and tell the UI once. */
  markUnlocked() {
    this.flushPending();
    if (this.unlocked) return;
    this.unlocked = true;
    this.ctx?.events?.emit('audio:unlocked', { style: this.getMusicStyle() });
  },

  flushPending() {
    if (this.wantMusic && this.music_ && this.music_.curName !== this.wantMusic) this.music_.play(this.wantMusic, { fade: 0.5 });
  },

  // ==== public API
  sfx(name, opts = {}) {
    if (name === 'uiBack') { name = 'uiMove'; opts = { ...opts, pitch: (opts.pitch || 1) * 0.7 }; }
    const def = SFX[name];
    if (!def) return null;
    if (!this.ensure()) return null;
    const ac = this.ac;
    if (ac.state !== 'running') {   // 'suspended', or 'interrupted' on iOS (calls, Siri, Control Center)
      const n = performance.now();
      if (n - this._resumeAt > 1000) { this._resumeAt = n; ac.resume().catch(() => {}); }
      return null;
    }
    const meta = SFX_META[name] || DEFAULT_META;
    const now = performance.now() / 1000;
    if (now - (this.last[name] ?? -9) < meta.gap) return null;
    if ((this.active[name] || 0) >= meta.max) return null;
    if (this.activeTotal >= MAX_VOICES && meta.prio < 3) return null;
    this.last[name] = now;
    this.lastAny[meta.group || name] = now;

    // positioned sounds take a pooled panner slot (spatial.js); everything else goes straight to the sfx bus
    const vg = ac.createGain();
    vg.gain.value = meta.gain ?? 1;
    let slot = null, panner = null;
    if (opts.position && opts.position.x !== undefined && this.spat) {
      slot = this.spat.acquire(this.ctx?.camera, opts.position);
      if (slot) vg.connect(slot.input);
      else {
        const fb = this.spat.fallback(this.ctx?.camera, opts.position, this._fb || (this._fb = { gain: 1, pan: 0 }));
        vg.gain.value *= fb.gain;
        if (ac.createStereoPanner) { panner = ac.createStereoPanner(); panner.pan.value = fb.pan; vg.connect(panner); panner.connect(this.sfxIn); } else vg.connect(this.sfxIn);
      }
    } else vg.connect(this.sfxIn);
    const env = { ac, out: vg, t: ac.currentTime + 0.005, v: opts.volume ?? 1, p: opts.pitch ?? 1, r: Math.random };
    const dur = def(env);
    this.active[name] = (this.active[name] || 0) + 1;
    this.activeTotal++;
    setTimeout(() => {
      this.active[name] -= 1; this.activeTotal -= 1;
      if (slot) this.spat.release(slot);
      try { vg.disconnect(); panner?.disconnect(); } catch (e) { /* ignore */ }
    }, (dur + 0.3) * 1000);
    return dur;
  },

  /** Level and pan of a world position relative to the camera (kept for callers that want the numbers). */
  spatial(pos) {
    if (!this.spat) return { gain: 1, pan: 0 };
    return this.spat.fallback(this.ctx?.camera, pos, { gain: 1, pan: 0 });
  },

  music(name) {
    this.wantMusic = name;
    if (!name) { this.music_?.stop(); return; }
    if (!this.ensure()) return;
    if (!this.music_.has(name)) return;
    this.music_.play(name, { fade: name === 'boss' ? 0.5 : name === 'gameover' ? 0.4 : 1.3 });
  },

  // Music styles (B default, A and C selectable). The style sets all music. See src/audio/styles/registry.js.
  musicStyles() { return styleList(); },
  getMusicStyle() { return (this._style ??= selectedStyle()); },
  setMusicStyle(id) {
    if (!styleList().some((s) => s.id === id)) return false;
    const changed = id !== this.getMusicStyle();
    this._style = id;
    saveStyle(id);
    this.music_?.setStyle(id, { fade: 0.9 });   // a playing track restarts in the new style with a crossfade
    if (changed) this.ctx?.events?.emit('audio:style', { id });
    return true;
  },
  // old names, still used by src/ui/screens.js
  titleVariants() { return this.musicStyles(); },
  getTitleVariant() { return this.getMusicStyle(); },
  setTitleVariant(id) { return this.setMusicStyle(id); },

  /** Debug hook: what is playing right now. */
  debug() {
    const m = this.music_;
    const s = m ? m.status() : { track: null, playing: false, intensity: 0, loop: null, source: null };
    return { style: this.getMusicStyle(), track: s.track, playing: s.playing, intensity: s.intensity, loop: s.loop, source: s.source, wanted: this.wantMusic, unlocked: this.unlocked, state: this.ac?.state ?? 'none' };
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

  // ==== engine voice (engine.js)
  /** State for the engine voice from the game: signed speed (-1 brake .. 0 cruise .. 1 boost), boost and brake amounts, steering, shield. */
  engineState(ctx) {
    const pl = ctx.player, st = ctx.state;
    const playing = st.phase === 'playing' && this.ac.state === 'running' && pl?.alive !== false;
    let speed = ctx.speedfx?.signed;
    let boost = pl?.boostAmount ?? 0, brake = pl?.brakeAmount ?? 0;
    if (performance.now() / 1000 - this.engineIn.at < 0.5) {
      // setEngine(speed01, boosting) override: 0.34 is the cruise point of the 0..1 speed range
      const s01 = this.engineIn.speed;
      speed = clamp((s01 - 0.34) / (s01 > 0.34 ? 0.66 : 0.34), -1, 1);
      boost = this.engineIn.boost ? 1 : Math.max(0, speed); brake = Math.max(0, -speed);
    } else if (!Number.isFinite(speed)) {
      const c = ctx.config?.rail;
      speed = ctx.rail && c ? clamp((ctx.rail.speed - c.baseSpeed) / (ctx.rail.speed >= c.baseSpeed ? c.boostSpeed - c.baseSpeed : c.baseSpeed - c.brakeSpeed), -1, 1) : 0;
    }
    const steer = clamp((pl?.localVelocity?.x ?? 0) / Math.max(1, ctx.config?.player?.speedX ?? 32), -1, 1);
    const health = st.maxHealth ? clamp(st.health / st.maxHealth, 0, 1) : 1;
    return { speed, boost, brake, steer, health, playing };
  },

  // ==== per frame
  update(dt, ctx) {
    if (ctx.phonediag && !this._diagReg && ctx.phonediag.add) { this._diagReg = true; ctx.phonediag.add('audio', () => this.diagLine()); }
    if (!this.ac) return;
    this.watchStall(ctx);
    this.eng.update(dt, this.engineState(ctx));
    this.mix.applyLevels(false);
    this.mix.tick();
    this.spat.update(ctx.camera);
    this.watchComm(ctx);
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

  /**
   * Phones: when the context has been running before and then stays out of 'running' (interrupted by a call, Siri or the lock
   * screen) for STALL_PAUSE_S while the game is playing, pause through the normal path (events 'ui:pause'). The pause menu is
   * the tap-to-resume prompt: its tap is a gesture, so the armed listeners resume the context. The delay keeps a RESUME tap
   * from pausing again while resume() is still resolving. Desktop never pauses for audio.
   */
  watchStall(ctx) {
    if (!device.touch) return;
    const ac = this.ac;
    if (ac.state === 'running' || !this.unlocked || document.hidden || ctx.state.phase !== 'playing') { this._stallSince = 0; return; }
    const now = performance.now() / 1000;
    if (!this._stallSince) { this._stallSince = now; this.armUnlock(); return; }
    if (now - this._stallSince > STALL_PAUSE_S) { this._stallSince = 0; ctx.events.emit('ui:pause'); }
  },

  // ==== ducking and voices
  /** Dip the music (and a share of the engine) for a while. See Mix.duck. reason is any string; the deepest active dip wins. */
  duckMusic(reason, o) { this.mix?.duck(reason, o); },

  /** A new comm line started: play its voice bark or data blips and dip the music under it. */
  watchComm(ctx) {
    const cur = ctx.ui?.commBox?.cur || null;
    if (cur === this._commCur) return;
    this._commCur = cur;
    if (!cur || !this.voice || this.ac.state !== 'running') return;
    const P = feel.p.audio;
    const typed = Math.min(2.6, Math.max(0.35, String(cur.text || '').length / (cur.portrait ? 44 : 62)));
    const len = this.voice.speak(cur.sp, cur.text, { duration: typed });
    if (len > 0) this.mix.duck('voice', { depth: P.duckVoiceDepth, hold: Math.max(len, typed) + 0.15, attack: P.duckVoiceAttack, release: P.duckVoiceRelease });
  },

  /** Big blast: dip the music briefly so the boom is heard. */
  duckBoom() {
    const P = feel.p.audio;
    this.mix?.duck('boom', { depth: P.duckBoomDepth, hold: P.duckBoomHold, attack: 0.03, release: P.duckBoomRelease });
  },

  /** Counters and node budgets for tests and the debug overlay. */
  stats() {
    return {
      state: this.ac?.state ?? 'none', duck: this.mix?.duckDepth ?? 1, ducks: this.mix ? [...this.mix.ducks.keys()] : [],
      spatial: this.spat?.stats ?? null, active: this.activeTotal, engineNodes: this.eng?.nodeCount ?? 0, barks: this.voice?.barks ?? 0,
    };
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
    on('player:fire', (p) => this.auto(p?.charged || p?.homing ? 'chargedShot' : p?.level >= 3 ? 'laser3' : p?.level === 2 ? 'laser2' : 'laser'));
    on('shot:reflected', (p) => this.auto('reflect', { position: p?.shot?.position }));
    on('player:lockon', () => {
      const now = performance.now() / 1000;
      const s = this.lockStreak;
      s.n = now - s.at < 0.8 ? Math.min(s.n + 1, 7) : 0;
      s.at = now;
      this.auto('lockon', { pitch: Math.pow(2, (s.n * 2) / 12) });
    });
    on('player:damage', () => this.auto('damage'));
    on('player:dead', () => { this.auto('bigExplosion'); this.duckBoom(); });
    on('player:bomb', () => { this.auto('bomb'); this.duckBoom(); });
    on('player:boost', (p) => { if (p?.on !== false) this.auto('boost'); });
    on('player:roll', () => this.auto('roll'));
    on('enemy:killed', (p) => {
      const e = p?.enemy;
      const big = e?.isBoss || (p?.points ?? 0) >= 1000 || (e?.radius ?? 0) >= 3.5;
      this.auto(big ? 'bigExplosion' : 'explosion', { position: pos(p), pitch: big ? 1 : 0.85 + Math.random() * 0.3 });
      if (big) this.duckBoom();
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
      if (p?.kind === 'capacitor') this.auto('capacitor');
      else if (p?.kind === 'shieldCell') this.auto('cell', { pitch: cellPitch() });
      else this.auto('pickup');
    });
    on('cell:collected', (p) => (p?.kind === 'capacitor' ? this.auto('capacitor') : this.auto('cell', { pitch: cellPitch() })));
    on('warning', () => this.auto('warning'));
    on('boss:spawn', () => { this.auto('warning'); this.music('boss'); });
    on('boss:phase', () => this.auto('bossHit', { volume: 1.2, pitch: 0.7 }));
    on('boss:defeated', () => {
      this.auto('bigExplosion');
      const P = feel.p.audio;
      this.mix?.duck('bossDeath', { depth: P.duckBossDepth, hold: P.duckBossHold, attack: 0.05, release: 1.6 });
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
    // camera takeovers (boss entrance and finisher lock the input): duck the music and mark both ends with a whoosh
    on('cinema:start', () => {
      const def = this.ctx.cinema?.def;
      if (!def || !def.lockInput) return;
      const P = feel.p.audio;
      this.mix?.duckStart('cinema', { depth: P.duckCinemaDepth, attack: 0.25, release: P.duckCinemaRelease, max: 6 });
      if (P.whooshCinema > 0 && performance.now() / 1000 - (this.last.whoosh ?? -9) > 1) this.auto('whoosh', { volume: P.whooshCinema });
    });
    on('cinema:end', () => {
      if (!this.mix?.ducks.has('cinema')) return;
      const P = feel.p.audio;
      this.mix.duckEnd('cinema');
      if (P.whooshCinema > 0) this.auto('whoosh', { volume: P.whooshCinema * 0.6, pitch: 0.8 });
    });
  },
};
