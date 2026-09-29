// Lists every sound effect for the sfx lab page, grouped by owner file, and holds the shared playback chain
// (the same gain, compressor and limiter as the game) used by the lab page and the offline test renders.
import { SFX, SFX_META } from '../sfx.js';
import { tone, noise } from '../synth.js';
import { WEAPON_SFX } from './weapons.js';
import { IMPACT_SFX } from './impacts.js';

export function sfxGroups() {
  const weapons = Object.keys(WEAPON_SFX), impacts = Object.keys(IMPACT_SFX);
  const taken = new Set([...weapons, ...impacts]);
  const legacy = Object.keys(SFX).filter((n) => !taken.has(n));
  return [
    { id: 'weapons', label: 'Weapons', names: weapons },
    { id: 'impacts', label: 'Impacts and pickups', names: impacts },
    { id: 'other', label: 'Other (legacy recipes)', names: legacy },
  ];
}

/** Realistic repeat interval in seconds for the lab's "Rapid x8" button. */
const RAPID = { laser: 1 / 8, laser2: 1 / 6.8, laser3: 1 / 5.6, lockon: 0.14, chargedShot: 0.4, reflect: 0.22, bomb: 0.6, laserCharge: 0.9 };
export function rapidInterval(name) {
  if (RAPID[name]) return RAPID[name];
  const m = SFX_META[name];
  return Math.max(0.12, (m?.gap ?? 0.05) * 2.5);
}

/** The game's mix chain: sfx gain, compressor, limiter, master gain (audio.js buildGraph). Works on Offline contexts too. */
export function createSfxChain(ac, master = 0.8) {
  const sfxIn = ac.createGain(); sfxIn.gain.value = 0.9;
  const mix = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const out = ac.createGain(); out.gain.value = master;
  sfxIn.connect(mix); mix.connect(comp); comp.connect(limiter); limiter.connect(out); out.connect(ac.destination);
  return { sfxIn, mix, comp, limiter, master: out, active: {}, last: {}, total: 0 };
}

/**
 * Plays one recipe the way audio.js sfx() does (voice gain from META, StereoPanner, env {ac,out,t,v,p,r}).
 * o: {volume, pitch, pan, r, t (absolute start time), recipe (override, e.g. a legacy one), respect (apply gap and max voices)}.
 * Returns the duration, or null when voice limits dropped the call.
 */
export function playSfx(ac, chain, name, o = {}) {
  const def = o.recipe || SFX[name];
  if (!def) return null;
  const meta = SFX_META[name] || { gap: 0.04, max: 4, prio: 2 };
  const t = o.t ?? ac.currentTime + 0.005;
  if (o.respect) {
    if (t - (chain.last[name] ?? -9) < meta.gap) return null;
    if ((chain.active[name] || 0) >= meta.max) return null;
    chain.last[name] = t;
  }
  const vg = ac.createGain();
  vg.gain.value = o.recipe ? 0.75 : (meta.gain ?? 1);   // legacy comparison uses the old laser gain
  let tail = vg;
  if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan ?? 0; vg.connect(p); tail = p; }
  tail.connect(chain.sfxIn);
  const dur = def({ ac, out: vg, t, v: o.volume ?? 1, p: o.pitch ?? 1, r: o.r || Math.random });
  chain.active[name] = (chain.active[name] || 0) + 1;
  if (o.onEnd) o.onEnd(dur);
  const done = () => { chain.active[name] -= 1; try { vg.disconnect(); tail.disconnect(); } catch (e) { /* gone */ } };
  if (!o.offline) setTimeout(done, (dur + 0.3) * 1000);   // an offline render keeps its graph
  return dur;
}

// The v1 weapon recipes, kept for A/B comparison in the lab and in the offline metrics.
const N = (e, o) => noise(e.ac, e.out, o);
const T = (e, o) => tone(e.ac, e.out, o);
export const LEGACY_WEAPONS = {
  laser(e) {
    const p = e.p * (0.94 + e.r() * 0.14);
    T(e, { t: e.t, dur: 0.14, vol: 0.3 * e.v, type: 'sawtooth', f0: 2300 * p, f1: 380 * p, sweep: 0.8, lp: 7000 });
    T(e, { t: e.t, dur: 0.12, vol: 0.17 * e.v, type: 'square', f0: 1150 * p, f1: 190 * p, sweep: 0.8, hp: 300 });
    T(e, { t: e.t, dur: 0.04, vol: 0.2 * e.v, type: 'sine', f0: 3600 * p, f1: 1000 * p });
    return 0.2;
  },
  laserCharge(e) {
    T(e, { t: e.t, dur: 0.75, vol: 0.13 * e.v, a: 0.5, type: 'sine', f0: 180 * e.p, f1: 1700 * e.p, sweep: 1 });
    T(e, { t: e.t, dur: 0.75, vol: 0.05 * e.v, a: 0.5, type: 'sawtooth', f0: 90 * e.p, f1: 850 * e.p, lp: 1800 });
    N(e, { t: e.t, dur: 0.75, vol: 0.05 * e.v, a: 0.5, type: 'bandpass', f0: 800, f1: 5000, q: 3 });
    return 0.85;
  },
  lockon(e) {
    T(e, { t: e.t, dur: 0.11, vol: 0.17 * e.v, type: 'sine', f0: 1568 * e.p, f1: 1568 * e.p });
    T(e, { t: e.t, dur: 0.11, vol: 0.06 * e.v, type: 'triangle', f0: 3136 * e.p });
    T(e, { t: e.t + 0.07, dur: 0.14, vol: 0.16 * e.v, type: 'sine', f0: 2093 * e.p });
    return 0.25;
  },
  chargedShot(e) {
    T(e, { t: e.t, dur: 0.6, vol: 0.2 * e.v, type: 'sawtooth', f0: 1500 * e.p, f1: 70 * e.p, sweep: 0.9, lp: 5000, lpEnd: 300 });
    T(e, { t: e.t, dur: 0.5, vol: 0.32 * e.v, type: 'sine', f0: 220 * e.p, f1: 42, sweep: 0.9 });
    N(e, { t: e.t, dur: 0.5, vol: 0.2 * e.v, type: 'bandpass', f0: 4200, f1: 300, q: 1.5 });
    T(e, { t: e.t, dur: 0.1, vol: 0.14 * e.v, type: 'square', f0: 4000, f1: 1200 });
    return 0.7;
  },
  bomb(e) {
    T(e, { t: e.t, dur: 1.5, vol: 0.6 * e.v, type: 'sine', f0: 115 * e.p, f1: 24, sweep: 0.9 });
    T(e, { t: e.t + 0.2, dur: 0.9, vol: 0.38 * e.v, type: 'sine', f0: 72, f1: 28 });
    N(e, { t: e.t, dur: 2.0, vol: 0.6 * e.v, type: 'lowpass', f0: 1300, f1: 55, buf: 'brown' });
    N(e, { t: e.t, dur: 0.6, vol: 0.28 * e.v, type: 'lowpass', f0: 5000, f1: 200 });
    N(e, { t: e.t + 0.3, dur: 1.4, vol: 0.14 * e.v, type: 'bandpass', f0: 900, f1: 120, q: 0.7 });
    for (let i = 0; i < 8; i++) N(e, { t: e.t + 0.1 + e.r() * 1.1, dur: 0.05, vol: 0.09 * e.v, type: 'highpass', f0: 3000 + e.r() * 3000 });
    return 2.1;
  },
};
