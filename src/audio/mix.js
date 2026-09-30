// Mix bus: four buses (music, sfx, voice, engine) into one master chain (compressor, brick wall limiter, master gain).
//
//   music  -> musicDuck --\
//   sfx    --------------- \
//   voice  ---------------- +-> sum -> compressor -> limiter -> master -> destination
//   engine -> engineDuck --/
//
// Ducking: mix.duck(reason, { depth, hold, attack, release }) dips the music bus to `depth` (gain, 1 = no dip) for `hold`
// seconds, then recovers over `release` seconds. mix.duckStart(reason, ...) / mix.duckEnd(reason) hold the dip open-ended (used
// for takeovers). Several reasons can be active at once, the deepest one wins. Attack and release are "time to about 95 percent"
// (the internal time constant is a third of that). The engine bus follows the music dip by feel.p.audio.duckEngine.
// mix.tick(now) must be called regularly (audio.update does it every frame); it accepts an explicit time for offline tests.
import { feel } from '../core/feel.js';

export const MASTER_DEFAULTS = {
  compThreshold: -16, compKnee: 14, compRatio: 4, compAttack: 0.004, compRelease: 0.2,
  limThreshold: -3, limKnee: 0, limRatio: 20, limAttack: 0.001, limRelease: 0.08,
};

/** Compressor, limiter and master gain into ac.destination. Returns { input, comp, limiter, master }. Shared with the sfx lab chain. */
export function createMasterChain(ac, { master = 0.8, dest = ac.destination, settings = MASTER_DEFAULTS } = {}) {
  const s = { ...MASTER_DEFAULTS, ...settings };
  const input = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = s.compThreshold; comp.knee.value = s.compKnee; comp.ratio.value = s.compRatio; comp.attack.value = s.compAttack; comp.release.value = s.compRelease;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = s.limThreshold; limiter.knee.value = s.limKnee; limiter.ratio.value = s.limRatio; limiter.attack.value = s.limAttack; limiter.release.value = s.limRelease;
  const out = ac.createGain(); out.gain.value = master;
  input.connect(comp); comp.connect(limiter); limiter.connect(out); out.connect(dest);
  return { input, comp, limiter, master: out };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MUSIC_BASE = 0.85;   // the music bus has always sat at 0.85 of its slider

export class Mix {
  /**
   * ac: AudioContext or OfflineAudioContext. opts: { getP: () => feel.p.audio, dest, vol }.
   * vol = the player's sliders { master, music, sfx } (0..1).
   */
  constructor(ac, { getP = () => feel.p.audio, dest = ac.destination, vol = { master: 0.8, music: 0.6, sfx: 0.9 } } = {}) {
    this.ac = ac;
    this.getP = getP;
    this.vol = { ...vol };
    this.pause = 1;           // extra music dip while the game is paused (set by audio.pauseMusic)
    const chain = createMasterChain(ac, { master: vol.master, dest });
    this.sum = chain.input; this.comp = chain.comp; this.limiter = chain.limiter; this.master = chain.master;
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    this.music = g(0); this.sfx = g(0); this.voice = g(0); this.engine = g(0);
    this.musicDuck = g(1); this.engineDuck = g(1);
    this.music.connect(this.musicDuck); this.musicDuck.connect(this.sum);
    this.sfx.connect(this.sum); this.voice.connect(this.sum);
    this.engine.connect(this.engineDuck); this.engineDuck.connect(this.sum);
    this.ducks = new Map();     // reason -> { depth, until (Infinity when open ended), attack, release }
    this.target = 1;            // current duck target (music gain multiplier)
    this.lastRelease = 0.5;
    this._applied = {};
    this.duckCount = 0;
    this.applyLevels(true);
  }

  /** Set the slider volumes and push every bus level. */
  setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx']) if (typeof v[k] === 'number') this.vol[k] = clamp(v[k], 0, 1);
    this.applyLevels(false);
  }

  setPause(k) { this.pause = k; this.applyLevels(false); }

  /** Push bus gains and compressor settings when they changed (cheap to call every frame). */
  applyLevels(immediate = false) {
    const P = this.getP(), t = this.ac.currentTime, tc = immediate ? 0.001 : 0.04;
    const set = (key, param, v, timeConstant = tc) => {
      if (this._applied[key] !== undefined && Math.abs(this._applied[key] - v) < 1e-4) return;
      this._applied[key] = v;
      param.setTargetAtTime(v, t, timeConstant);
    };
    set('master', this.master.gain, this.vol.master);
    set('music', this.music.gain, this.vol.music * MUSIC_BASE * this.pause * P.busMusic);
    set('sfx', this.sfx.gain, this.vol.sfx * P.busSfx);
    set('voice', this.voice.gain, this.vol.sfx * P.busVoice);
    set('engine', this.engine.gain, this.vol.sfx * P.busEngine);
    set('compT', this.comp.threshold, P.compThreshold, 0.02);
    set('compR', this.comp.ratio, P.compRatio, 0.02);
    set('limT', this.limiter.threshold, P.limitThreshold, 0.02);
  }

  // ==== ducking
  /** Timed dip: depth (gain multiplier), hold and release in seconds, attack in seconds. A deeper active dip is never replaced by a shallower one. */
  duck(reason, { depth = 0.6, hold = 0.3, attack = 0.06, release = 0.8 } = {}, now = this.ac.currentTime) {
    const prev = this.ducks.get(reason);
    const until = now + Math.max(0, hold);
    if (prev && prev.until > now && prev.depth < depth) { prev.until = Math.max(prev.until, until); prev.release = release; }
    else this.ducks.set(reason, { depth, until, attack, release });
    this.duckCount++;
    this.tick(now);
  }

  /** Open ended dip, held until duckEnd(reason). A safety `max` (seconds) ends it anyway. */
  duckStart(reason, { depth = 0.6, attack = 0.15, release = 1, max = 8 } = {}, now = this.ac.currentTime) {
    this.ducks.set(reason, { depth, until: now + max, attack, release, open: true });
    this.duckCount++;
    this.tick(now);
  }

  duckEnd(reason, now = this.ac.currentTime) {
    const d = this.ducks.get(reason);
    if (d) { d.until = now; this.tick(now); }
  }

  /** Recompute the duck target and steer the two duck gains toward it. */
  tick(now = this.ac.currentTime) {
    let target = 1, atk = 0.1, expired = null;
    for (const [reason, d] of this.ducks) {
      if (d.until <= now) { this.ducks.delete(reason); expired = d; continue; }
      if (d.depth < target) { target = d.depth; atk = d.attack; }
    }
    if (expired) this.lastRelease = expired.release;
    if (Math.abs(target - this.target) > 1e-6) {
      const P = this.getP();
      const tc = (target < this.target ? atk : this.lastRelease) / 3;
      this.musicDuck.gain.setTargetAtTime(target, now, Math.max(0.004, tc));
      this.engineDuck.gain.setTargetAtTime(1 - (1 - target) * P.duckEngine, now, Math.max(0.004, tc));
      this.target = target;
    }
  }

  /** Current duck target (1 = none). */
  get duckDepth() { return this.target; }

  dispose() {
    for (const n of [this.music, this.sfx, this.voice, this.engine, this.musicDuck, this.engineDuck, this.sum, this.comp, this.limiter, this.master]) { try { n.disconnect(); } catch (e) { /* gone */ } }
  }
}
