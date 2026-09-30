// Weapon sound effects Same recipe format as ../sfx.js: fn(e) with
// e = {ac, out, t, v, p, r} returns the duration in seconds; META entries set voice limits per name.
// Names defined here override the legacy recipes in ../sfx.js. WEAPON_SFX_PREV holds the previous laser recipes for A/B in the lab.
// Measure changes with tools/sfxanalyze.mjs (profile table, variation, rapid fire train, node counts, peak budget).
//
// Design: every weapon is built from layers instead of one swept oscillator.
//   1. transient   a 10 to 25 ms band-passed noise click (2 to 6 ms attack, colour varies per shot)
//   2. body        a pitch-dropped sine (plus harmonics or a saw for the heavier levels) through a tanh saturator
//   3. metal       a short FM zap (inharmonic carrier/modulator ratio, the modulation index dies quickly), a ring
//                  modulated saw and a narrow resonant noise band for crackle
//   4. space       a 3 to 5 ms feedback comb (metallic ring) and a slapback echo on the heavier weapons
//   5. width       two detuned voices, one delayed by a few ms (Haas), panned left and right
// Every shot draws its pitch, gain and transient colour from e.r(), so rapid fire never machine-guns.
import { tone, noise, getNoise } from '../synth.js';

const rr = (e, a, b) => a + (b - a) * e.r();
const nyq = (e, f) => Math.min(f, e.ac.sampleRate * 0.45);
const gone = (nodes) => () => { for (const n of nodes) { try { n.disconnect(); } catch (err) { /* already gone */ } } };

const curves = new Map();
function satCurve(k) {
  let c = curves.get(k);
  if (!c) {
    c = new Float32Array(2048);
    const n = Math.tanh(k);
    for (let i = 0; i < c.length; i++) c[i] = Math.tanh(k * ((i / (c.length - 1)) * 2 - 1)) / n;
    curves.set(k, c);
  }
  return c;
}

/** Bit crusher: quantises the input to 2^bits levels. Used without oversampling on purpose, the aliasing is the grit. */
function stepCurve(bits) {
  const key = `step${bits}`;
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(2048);
    const lv = Math.pow(2, bits - 1);
    for (let i = 0; i < c.length; i++) c[i] = Math.round(((i / (c.length - 1)) * 2 - 1) * lv) / lv;
    curves.set(key, c);
  }
  return c;
}

/** Sine fold: harder drive folds the wave back on itself, adding bright inharmonic metal. */
function foldCurve(k) {
  const key = `fold${k}`;
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) c[i] = Math.sin(k * ((i / (c.length - 1)) * 2 - 1) * Math.PI * 0.5);
    curves.set(key, c);
  }
  return c;
}

/**
 * A small processing bus. Returns its input node; the chain is gain, [highpass], [lowpass], [saturator],
 * [delay], [pan] and ends at o.dest (default e.out, null leaves the end open for the caller).
 * o: {gain, hp, lp, sat, curve (a custom shaper curve instead of tanh), over ('none' | '2x' | '4x'), post, delay, pan, dest}
 */
function bus(e, o = {}) {
  const ac = e.ac;
  const input = ac.createGain();
  input.gain.value = o.gain ?? 1;
  let tail = input;
  const add = (n) => { tail.connect(n); tail = n; };
  if (o.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = nyq(e, o.hp); f.Q.value = 0.6; add(f); }
  if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = nyq(e, o.lp); f.Q.value = 0.5; add(f); }
  if (o.sat || o.curve) {
    const s = ac.createWaveShaper(); s.curve = o.curve || satCurve(o.sat); s.oversample = o.over || '2x'; add(s);
    const g = ac.createGain(); g.gain.value = o.post ?? 0.7; add(g);
  }
  if (o.delay) { const d = ac.createDelay(0.05); d.delayTime.value = o.delay; add(d); }
  if (o.pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan; add(p); }
  if (o.dest !== null) tail.connect(o.dest || e.out);
  return input;
}

/** Feedback delay: a comb (3 to 5 ms, metallic ring) or an echo. Returns its input. o: {time, fb, lp, mix} */
function echo(e, dest, o) {
  const ac = e.ac;
  const input = ac.createGain();
  const d = ac.createDelay(0.5); d.delayTime.value = Math.max(0.003, o.time);   // a loop cannot be shorter than 128 samples
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = nyq(e, o.lp ?? 3500); lp.Q.value = 0.4;
  const fb = ac.createGain(); fb.gain.value = o.fb ?? 0.4;
  const mix = ac.createGain(); mix.gain.value = o.mix ?? 0.3;
  input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(mix); mix.connect(dest);
  return input;
}

function env(param, t, a, vol, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(vol, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

/**
 * FM voice: a sine carrier whose frequency is modulated by an inharmonic modulator with a fast dying index.
 * o: {t, dur, f0, f1, vol, a, sweep, ratio, depth, mdecay, type, detune, sends}
 */
function fm(e, dest, o) {
  const ac = e.ac, t = o.t, dur = o.dur, sw = t + dur * (o.sweep ?? 0.7);
  const car = ac.createOscillator(); car.type = o.type || 'sine';
  const f1 = o.f1 ?? o.f0;
  car.frequency.setValueAtTime(o.f0, t);
  if (f1 !== o.f0) car.frequency.exponentialRampToValueAtTime(f1, sw);
  if (o.detune) car.detune.value = o.detune;
  const g = ac.createGain(); env(g.gain, t, o.a ?? 0.0015, o.vol, dur);
  const nodes = [car, g];
  if (o.depth) {
    const mod = ac.createOscillator();
    mod.frequency.setValueAtTime(o.f0 * o.ratio, t);
    if (f1 !== o.f0) mod.frequency.exponentialRampToValueAtTime(f1 * o.ratio, sw);
    if (o.detune) mod.detune.value = o.detune;
    const md = ac.createGain();
    md.gain.setValueAtTime(o.depth, t);
    md.gain.exponentialRampToValueAtTime(1, t + dur * (o.mdecay ?? 0.4));
    mod.connect(md); md.connect(car.frequency);
    mod.start(t); mod.stop(t + dur + 0.05);
    nodes.push(mod, md);
  }
  car.connect(g); g.connect(dest);
  for (const s of o.sends || []) g.connect(s);
  car.start(t); car.stop(t + dur + 0.05);
  car.onended = gone(nodes);
}

/** Ring modulated voice: a swept oscillator times a sine (sum and difference tones, a clang). */
function ring(e, dest, o) {
  const ac = e.ac, t = o.t, dur = o.dur;
  const src = ac.createOscillator(); src.type = o.type || 'sawtooth';
  src.frequency.setValueAtTime(o.f0, t);
  if (o.f1) src.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
  const car = ac.createOscillator();
  car.frequency.setValueAtTime(o.rf, t);
  if (o.rf1) car.frequency.exponentialRampToValueAtTime(o.rf1, t + dur);
  const rm = ac.createGain(); rm.gain.value = 0;
  car.connect(rm.gain);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = nyq(e, o.lp ?? 5000); lp.Q.value = 0.5;
  const g = ac.createGain(); env(g.gain, t, o.a ?? 0.002, o.vol, dur);
  src.connect(rm); rm.connect(lp); lp.connect(g); g.connect(dest);
  src.start(t); car.start(t); src.stop(t + dur + 0.05); car.stop(t + dur + 0.05);
  src.onended = gone([src, car, rm, lp, g]);
}

/** Resonant noise band: a narrow band-passed noise whose centre sweeps, heard as a crackling whistle. */
const band = (e, dest, o) => noise(e.ac, dest, { offset: e.r(), type: 'bandpass', q: 8, ...o });

/** Scatter of tiny noise ticks (electric crackle) spread over o.span seconds, fading out. */
function crackle(e, buses, o) {
  for (let i = 0; i < o.n; i++) {
    const k = i / Math.max(1, o.n - 1);
    noise(e.ac, buses[Math.floor(e.r() * buses.length)], {
      t: o.t + k * o.span * rr(e, 0.8, 1.2), dur: 0.02, a: 0.001, vol: o.vol * (1 - 0.75 * k) * rr(e, 0.6, 1.2), offset: e.r(),
      type: 'bandpass', f0: rr(e, o.f0, o.f1), q: 1.6,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The laser sounds: the classic laser first, character on top.
// Design target (see tools/sfxanalyze.mjs to measure it): a harmonic rich tone (saw like, harmonics up
// to 10 kHz) whose whole stack FALLS along an exponential curve, about 1.7 to 2.4 octaves in 0.2 to 0.5 s, fast at first (5 to 15 octaves
// per second) and slowing down, with the level held along the fall and no separate click plus thump plus ring layers. So every laser here
// is built on sweep(): one or two detuned saws that fall along that curve with a low pass following the pitch. Character goes on top:
//   laser   crisp and bright     a bright, fast fall with an octave shimmer, a hard click and an airy noise band
//   laser2  gritty, industrial   a slower saw fall through a bit crusher and a sine fold, a gated buzz, a ring modulated clang, twin barrels
//   laser3  punchy, bass heavy   a deep fall with its own sub sine that drops along with it (a heavy thump inside the laser, not a kick)
// The enemy shot, turret shot, boss beam, boss charge, boss cannon and ally shots use the same fall in other registers so the whole
// game sounds like one weapon family, and every shooter is recognisable by ear.
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The laser voice. A tone whose pitch falls exponentially toward f1 with time constant tau (fast at first, then slower, the shape of the
 * recorded lasers) and whose low pass follows the pitch, so the brightness falls with it. The level attacks in a=2 ms, holds for `hold`
 * of dur and then dies away. o: {t, dur, f0, f1, tau, vol, type, a, hold, k (cutoff = k times the pitch), lpMin, q, detune (cents),
 * vib (cents of vibrato), vibRate, rise (true: the pitch rises instead, used for charge-ups)}
 */
function sweep(e, dest, o) {
  const ac = e.ac, t = o.t, dur = o.dur;
  const osc = ac.createOscillator(); osc.type = o.type || 'sawtooth';
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.setTargetAtTime(o.f1, t, o.tau);
  if (o.detune) osc.detune.value = o.detune;
  const nodes = [osc];
  let tail = osc;
  if (o.k) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(nyq(e, Math.max(o.lpMin ?? 400, o.f0 * o.k)), t);
    f.frequency.setTargetAtTime(nyq(e, Math.max(o.lpMin ?? 400, o.f1 * o.k)), t, o.tau);
    osc.connect(f); tail = f; nodes.push(f);
  }
  const g = ac.createGain(), a = o.a ?? 0.002, h = t + Math.max(a + 0.001, dur * (o.hold ?? 0.3));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.vol, t + a);
  g.gain.setValueAtTime(o.vol, h);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  tail.connect(g); g.connect(dest); nodes.push(g);
  let lfo = null;
  if (o.vib) {
    lfo = ac.createOscillator(); lfo.frequency.value = o.vibRate ?? 30;
    const d = ac.createGain(); d.gain.value = o.vib;
    lfo.connect(d); d.connect(osc.detune); lfo.start(t); lfo.stop(t + dur + 0.05); nodes.push(lfo, d);
  }
  osc.start(t); osc.stop(t + dur + 0.05);
  osc.onended = gone(nodes);
}

//
// Level 1: crisp and bright. A short fall with an airy top (noise above 4 kHz). Fall from 2.9 kHz to 520 Hz with tau 50 ms, two detuned saws for width, an octave shimmer, a light body, a click and an air band.
//
function laserBright(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.95, 1.06), v = e.v * rr(e, 0.9, 1.1), col = e.r(), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 70, lp: 13000, sat: 1.5, post: 0.8 });
  const L = bus(e, { pan: -0.3 * side, dest: out }), R = bus(e, { pan: 0.3 * side, delay: 0.005, dest: out });
  const S = bus(e, { sat: 2, post: 0.7, dest: out });
  const f0 = 2900 * p, f1 = 520 * p, tau = rr(e, 0.045, 0.058);
  sweep(e, L, { t, dur: 0.2, f0, f1, tau, vol: 0.26 * v, k: 7, lpMin: 3400, q: 2.5, detune: -9, hold: 0.3 });
  sweep(e, R, { t, dur: 0.19, f0: f0 * 1.004, f1, tau, vol: 0.2 * v, k: 7, lpMin: 3400, q: 2.5, detune: 9, hold: 0.3 });
  sweep(e, L, { t, dur: 0.12, f0: f0 * 2, f1: f1 * 2, tau, vol: 0.08 * v, type: 'square', k: 2.6, lpMin: 4200, hold: 0.2 });
  sweep(e, S, { t, dur: 0.14, f0: f0 * 0.5, f1: f1 * 0.5, tau, vol: 0.16 * v, type: 'sine', hold: 0.2 });
  tone(ac, S, { t, dur: 0.06, a: 0.0015, vol: 0.1 * v, type: 'sine', f0: 250 * p, f1: 90 * p, sweep: 0.5, hold: 0 });
  noise(ac, out, { t, dur: 0.015, a: 0.0006, vol: 0.32 * v, type: 'highpass', f0: 5200 + col * 2600, offset: e.r() });
  noise(ac, out, { t, dur: 0.13, a: 0.002, vol: 0.34 * v, type: 'bandpass', f0: 7600 * p, f1: 2600 * p, q: 1.3, offset: e.r() });
  return 0.22;
}

//
// Level 2: gritty and industrial. A saw stack over a steady buzz that is cut off hard, with a rough thump. Two barrels 30 ms apart. Each is a slower saw fall (1.7 kHz to 230 Hz, tau 75 ms) through a bit crusher and a second copy an octave down
// through a sine fold, plus a gated square buzz, a ring modulated clang, a clank of noise and a sub that drops with it.
//
function gritBarrel(e, out, S, sends, t, pan, p, v, full) {
  const ac = e.ac;
  const crush = bus(e, { gain: rr(e, 2.0, 3.0), curve: stepCurve(4 + Math.floor(e.r() * 3)), over: 'none', post: 0.5, dest: bus(e, { pan, lp: 5200, dest: out }) });
  const B = bus(e, { pan, dest: out });
  const f0 = 1700 * p, f1 = 230 * p, tau = rr(e, 0.065, 0.085);
  sweep(e, crush, { t, dur: full ? 0.27 : 0.2, f0, f1, tau, vol: 0.3 * v, k: 4.5, lpMin: 1800, q: 1.5, hold: 0.45 });
  noise(ac, B, { t, dur: 0.03, a: 0.0008, vol: 0.45 * v, type: 'bandpass', f0: rr(e, 1300, 2600), q: 1.4, offset: e.r() });
  sweep(e, S, { t, dur: 0.16, f0: 130 * p, f1: 45 * p, tau: 0.05, vol: 0.22 * v, type: 'sine', hold: 0.3 });
  if (full) {
    const fold = bus(e, { gain: 1.8, curve: foldCurve(2.2), post: 0.4, dest: bus(e, { pan, hp: 400, lp: 7000, dest: out }) });
    sweep(e, fold, { t, dur: 0.22, f0: f0 * 0.5, f1: f1 * 0.5, tau, vol: 0.34 * v, k: 6, lpMin: 900, hold: 0.4 });
    ring(e, B, { t, dur: 0.12, f0: 820 * p, f1: 300 * p, rf: 233 * p, rf1: 131 * p, vol: 0.22 * v, lp: 4400 });
    rattle(e, B, { t: t + 0.004, dur: 0.16, vol: 1.2 * v, f: rr(e, 1500, 2300), q: 2.2, rate: rr(e, 88, 104), depth: 0.9 });
    // the steady buzz of the large laser, gated off hard at the end
    tone(ac, crush, { t, dur: 0.2, a: 0.002, vol: 0.09 * v, type: 'square', f0: 150 * p, hold: 1, lp: 1400 });
  }
  for (const s of sends) sweep(e, s, { t, dur: 0.06, f0: 2000 * p, f1: 600 * p, tau: 0.03, vol: 0.05 * v, k: 3, lpMin: 1500 });
}

function laserGrit(e) {
  const { t } = e;
  const p = e.p * rr(e, 0.94, 1.06), v = e.v * rr(e, 0.9, 1.1), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 40, lp: 10000, sat: 1.7, post: 0.76 });
  const slap = echo(e, out, { time: 0.057, fb: 0.14, lp: 2800, mix: 0.12 });
  const S = bus(e, { sat: 2.6, post: 0.62, dest: out });
  gritBarrel(e, out, S, [slap], t, -0.4 * side, p, v, true);
  gritBarrel(e, out, S, [slap], t + 0.03 + rr(e, -0.004, 0.004), 0.4 * side, p * rr(e, 0.9, 1.1), v * 0.8, false);
  return 0.3;
}

//
// Level 3: punchy and bass heavy. A fast fall that settles on a low tone, sub and low heavy. A deep fall (1.5 kHz to 120 Hz, tau 70 ms) through saturation, with its own sub sine falling from 150 to 40 Hz along the same
// curve so the weight is part of the laser instead of a separate kick, a low saw one octave down for growl, and a short mid crack.
//
function laserPunch(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.96, 1.05), v = e.v * rr(e, 0.92, 1.08), col = e.r();
  const out = bus(e, { hp: 28, lp: 9500, sat: 1.9, post: 0.72 });
  const M = bus(e, { sat: 2.2, post: 0.66, dest: out });
  const Q = bus(e, { gain: 1.5, sat: 3.4, post: 0.55, dest: out });
  const L = bus(e, { pan: -0.4, dest: out }), R = bus(e, { pan: 0.4, delay: 0.004, dest: out });
  const tau = rr(e, 0.06, 0.075);
  sweep(e, Q, { t, dur: 0.25, f0: 1500 * p, f1: 125 * p, tau, vol: 0.3 * v, k: 3.6, lpMin: 900, q: 1.5, hold: 0.35 });
  sweep(e, L, { t, dur: 0.2, f0: 2100 * p, f1: 260 * p, tau: tau * 0.8, vol: 0.09 * v, detune: -10, k: 4, lpMin: 2000, hold: 0.25 });
  sweep(e, R, { t, dur: 0.2, f0: 2100 * p * 1.004, f1: 260 * p, tau: tau * 0.8, vol: 0.09 * v, detune: 10, k: 4, lpMin: 2000, hold: 0.25 });
  sweep(e, M, { t, dur: 0.26, f0: 150 * p, f1: 40 * p, tau: 0.055, vol: 0.5 * v, type: 'sine', hold: 0.35 });
  sweep(e, Q, { t, dur: 0.16, f0: 700 * p, f1: 62 * p, tau, vol: 0.14 * v, k: 1.5, lpMin: 300, q: 2, hold: 0.25 });
  noise(ac, out, { t, dur: 0.04, a: 0.0007, vol: 1.6 * v, type: 'bandpass', f0: 2100 + col * 1800, q: 0.85, offset: e.r() });
  noise(ac, out, { t, dur: 0.03, a: 0.0008, vol: 0.7 * v, type: 'lowpass', f0: 1300, q: 0.7, offset: e.r() });
  return 0.28;
}

//
// Enemy laser (every ordinary shooter): the same fall but hostile. It starts lower (1.15 kHz), is thinner (high passed, square plus a dissonant saw so it
// beats), harsh (sine folded), has no sub and no width, and is quieter than the player's lasers.
//
function enemyLaser(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.93, 1.07), v = e.v * rr(e, 0.9, 1.1), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 320, lp: 7000, pan: 0.15 * side });
  const F = bus(e, { gain: 1.7, curve: foldCurve(1.8), post: 0.5, dest: out });
  const tau = rr(e, 0.04, 0.052);
  sweep(e, F, { t, dur: 0.17, f0: 1150 * p, f1: 210 * p, tau, vol: 0.2 * v, type: 'square', k: 4, lpMin: 1200, q: 2.2, hold: 0.4 });
  sweep(e, F, { t, dur: 0.15, f0: 1150 * p * 1.41, f1: 210 * p * 1.41, tau, vol: 0.08 * v, type: 'sawtooth', k: 3, lpMin: 1500, detune: 14, hold: 0.3 });
  noise(ac, out, { t, dur: 0.014, a: 0.0006, vol: 0.2 * v, type: 'bandpass', f0: rr(e, 1800, 3000), q: 1.1, offset: e.r() });
  return 0.19;
}

//
// Turret laser (heavy, slow enemy guns): the enemy fall again but slower and heavier, an octave and a half lower, with a weighty sub.
//
function turretLaser(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.95, 1.05), v = e.v * rr(e, 0.92, 1.08);
  const out = bus(e, { hp: 45, lp: 6500, sat: 1.6, post: 0.8 });
  const F = bus(e, { gain: 1.5, curve: foldCurve(1.6), post: 0.5, dest: out });
  const S = bus(e, { sat: 2.2, post: 0.66, dest: out });
  const tau = rr(e, 0.11, 0.135);
  sweep(e, F, { t, dur: 0.42, f0: 820 * p, f1: 80 * p, tau, vol: 0.2 * v, type: 'sawtooth', k: 4, lpMin: 700, q: 1.5, hold: 0.4 });
  sweep(e, F, { t, dur: 0.36, f0: 410 * p, f1: 40 * p, tau, vol: 0.16 * v, type: 'square', k: 3, lpMin: 400, hold: 0.4 });
  sweep(e, S, { t, dur: 0.36, f0: 110 * p, f1: 40 * p, tau: 0.08, vol: 0.3 * v, type: 'sine', hold: 0.4 });
  noise(ac, out, { t, dur: 0.03, a: 0.001, vol: 0.4 * v, type: 'bandpass', f0: 1200, q: 1, offset: e.r() });
  return 0.46;
}

//
// Boss charge: the mirror of the laser fall, a rising stack (the laser winding up) with a vibrato that speeds up, a shimmering noise band and a latch.
// Used for the charge-ups of the Orrery beam, the Tidebreaker siege cannon and the Regent emitters.
//
function bossCharge(e) {
  const { ac, t } = e;
  const p = e.p, v = e.v, D = 1.0;
  const out = bus(e, { lp: 9000, sat: 1.4, post: 0.85 });
  for (const [det, pan] of [[-8, -0.4], [8, 0.4]]) {
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(90 * p, t); o.frequency.exponentialRampToValueAtTime(1500 * p, t + D);
    o.detune.value = det;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(nyq(e, 7000), t + D);
    const g = ac.createGain(); g.gain.setValueAtTime(0.02 * v, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + D * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.06);
    const vib = ac.createOscillator(); vib.frequency.setValueAtTime(5, t); vib.frequency.exponentialRampToValueAtTime(34, t + D);
    const vd = ac.createGain(); vd.gain.setValueAtTime(8, t); vd.gain.linearRampToValueAtTime(60, t + D);
    vib.connect(vd); vd.connect(o.detune);
    o.connect(f); f.connect(g); g.connect(bus(e, { pan, dest: out }));
    o.start(t); vib.start(t); o.stop(t + D + 0.1); vib.stop(t + D + 0.1);
    o.onended = gone([o, f, g, vib, vd]);
  }
  tone(ac, out, { t, dur: D + 0.05, a: D * 0.7, vol: 0.14 * v, type: 'sine', f0: 45 * p, f1: 120 * p, sweep: 1, hold: 0 });
  noise(ac, out, { t, dur: D, a: D * 0.8, vol: 0.1 * v, type: 'bandpass', f0: 1200, f1: 7000, q: 2.5, offset: e.r() });
  const lt = t + D + 0.005;
  noise(ac, out, { t: lt, dur: 0.03, a: 0.0015, vol: 0.2 * v, type: 'bandpass', f0: 3400, q: 1.1, offset: e.r() });
  tone(ac, out, { t: lt, dur: 0.14, a: 0.002, vol: 0.2 * v, type: 'sine', f0: 200 * p, f1: 60, sweep: 0.5, hold: 0 });
  return D + 0.2;
}

//
// Boss cannon: the big laser. A huge fall (3.4 kHz to 55 Hz, tau 150 ms) with a deep sub that falls with it, a wide noise shock and a sub tail.
// Deliberately the loudest laser in the game (peak about 0.6), used for the Tidebreaker siege cannon and the Regent's heavy shots.
//
function bossCannon(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.97, 1.03), v = e.v;
  const out = bus(e, { hp: 22, lp: 11000, sat: 1.7, post: 0.78 });
  const S = bus(e, { sat: 2.4, post: 0.66, dest: out });
  const L = bus(e, { pan: -0.4, dest: out }), R = bus(e, { pan: 0.4, delay: 0.006, dest: out });
  const slap = echo(e, out, { time: 0.09, fb: 0.28, lp: 2400, mix: 0.16 });
  sweep(e, S, { t, dur: 0.95, f0: 3400 * p, f1: 55 * p, tau: 0.15, vol: 0.5 * v, k: 3.2, lpMin: 500, q: 1.6, hold: 0.3 });
  sweep(e, L, { t, dur: 0.7, f0: 3400 * p, f1: 110 * p, tau: 0.13, vol: 0.13 * v, detune: -12, k: 4, lpMin: 1200, hold: 0.25 });
  sweep(e, R, { t, dur: 0.7, f0: 3400 * p * 1.004, f1: 110 * p, tau: 0.13, vol: 0.13 * v, detune: 12, k: 4, lpMin: 1200, hold: 0.25 });
  sweep(e, S, { t, dur: 1.1, f0: 140 * p, f1: 30 * p, tau: 0.16, vol: 0.3 * v, type: 'sine', hold: 0.4 });
  noise(ac, out, { t, dur: 0.05, a: 0.001, vol: 1.6 * v, type: 'bandpass', f0: 2200, q: 0.8, offset: e.r() });
  noise(ac, out, { t, dur: 0.6, a: 0.004, vol: 0.4 * v, type: 'lowpass', f0: 5200, f1: 220, q: 0.7, offset: e.r() });
  sweep(e, slap, { t, dur: 0.1, f0: 1800 * p, f1: 300 * p, tau: 0.04, vol: 0.1 * v, k: 3, lpMin: 900 });
  return 1.3;
}

//
// Boss beam: a sustained beam (the Orrery sweep, the Regent emitters), about 1.8 s. It opens with a laser fall, settles into a steady hum with a
// slow swell and a shimmer (a fast vibrato and an amplitude flutter), and ends with a short fall in the pitch. Loud enough to notice (peak about 0.5).
//
function bossBeam(e) {
  const { ac, t } = e;
  const p = e.p, v = e.v, D = 1.8;
  const out = bus(e, { hp: 35, lp: 9000, sat: 1.5, post: 0.8 });
  const S = bus(e, { sat: 2, post: 0.7, dest: out });
  const L = bus(e, { pan: -0.35, dest: out }), R = bus(e, { pan: 0.35, delay: 0.005, dest: out });
  // opening fall
  sweep(e, out, { t, dur: 0.28, f0: 3000 * p, f1: 180 * p, tau: 0.07, vol: 0.22 * v, k: 3.5, lpMin: 800, hold: 0.3 });
  // the hum: two detuned saws a little above 100 Hz, slowly swelling, low pass opening
  for (const [bs, det] of [[L, -12], [R, 12]]) {
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(190 * p, t); o.frequency.setTargetAtTime(118 * p, t, 0.12); o.frequency.linearRampToValueAtTime(128 * p, t + D);
    o.detune.value = det;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(nyq(e, 2600), t + D * 0.7);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 * v, t + 0.12); g.gain.setValueAtTime(0.2 * v, t + D - 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    const fl = ac.createOscillator(); fl.frequency.value = 23; const fd = ac.createGain(); fd.gain.value = 0.03 * v;   // amplitude flutter
    fl.connect(fd); fd.connect(g.gain);
    o.connect(f); f.connect(g); g.connect(bs);
    o.start(t); fl.start(t); o.stop(t + D + 0.05); fl.stop(t + D + 0.05);
    o.onended = gone([o, f, g, fl, fd]);
  }
  // shimmer: a bright sine with fast wide vibrato, the laser glitter
  {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1300 * p, t); o.frequency.linearRampToValueAtTime(1550 * p, t + D);
    const vb = ac.createOscillator(); vb.frequency.value = 41; const vd = ac.createGain(); vd.gain.value = 300;   // Hz of deviation
    vb.connect(vd); vd.connect(o.frequency);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.075 * v, t + 0.3); g.gain.setValueAtTime(0.075 * v, t + D - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    o.connect(g); g.connect(out);
    o.start(t); vb.start(t); o.stop(t + D + 0.05); vb.stop(t + D + 0.05);
    o.onended = gone([o, vb, vd, g]);
  }
  sweep(e, S, { t, dur: D, f0: 90 * p, f1: 55 * p, tau: 0.3, vol: 0.1 * v, type: 'sine', hold: 0.8 });
  noise(ac, out, { t: t + 0.05, dur: D - 0.1, a: 0.2, vol: 0.1 * v, type: 'bandpass', f0: 5200, q: 3, offset: e.r() });
  return D + 0.1;
}

//
// Ally lasers: the same fall, lighter and higher, thin and quiet, panned to one side, so friendly fire reads as the player's family but is easy to
// tell from the player's own weapon. VEX passes a higher pitch. The drone blip is a tiny two note chirp.
//
function allyLaser(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.94, 1.07), v = e.v * rr(e, 0.9, 1.1), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 500, lp: 11000, pan: 0.5 * side });
  sweep(e, out, { t, dur: 0.11, f0: 3600 * p, f1: 900 * p, tau: 0.032, vol: 0.14 * v, type: 'sawtooth', k: 3.5, lpMin: 2600, q: 1.5, hold: 0.25 });
  sweep(e, out, { t, dur: 0.09, f0: 5000 * p, f1: 1300 * p, tau: 0.028, vol: 0.05 * v, type: 'triangle', hold: 0.2 });
  noise(ac, out, { t, dur: 0.012, a: 0.0006, vol: 0.14 * v, type: 'highpass', f0: 6000, offset: e.r() });
  return 0.12;
}

function allyBlip(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.95, 1.06), v = e.v * rr(e, 0.9, 1.1), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 700, lp: 9000, pan: 0.55 * side });
  sweep(e, out, { t, dur: 0.05, f0: 2600 * p, f1: 1500 * p, tau: 0.02, vol: 0.09 * v, type: 'sine', hold: 0.4 });
  sweep(e, out, { t: t + 0.045, dur: 0.05, f0: 3300 * p, f1: 2000 * p, tau: 0.02, vol: 0.06 * v, type: 'sine', hold: 0.4 });
  return 0.11;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The earlier player lasers (crisp, gritty and bass character, but without the classic falling sweep). Kept as 'Prev' for A/B. One idea per level, three clearly different characters:
//   laser   (level 1) CRISP AND BRIGHT     a hard click, a resonant saw zap falling through a closing filter, a glassy FM ping, a small thump
//   laser2  (level 2) GRITTY AND INDUSTRIAL twin barrels, bit crushed and folded saw, a ring modulated clang, an amplitude gated rattle
//   laser3  (level 3) PUNCHY AND BASS HEAVY a pitch dropped sub, a saturated second harmonic for small speakers, a kick style click, a short ring
// Each is transient plus body plus tail, with detuned or delayed pairs for width and random pitch, gain and colour per shot.
// Bass layers stay in the centre (mono), only the upper layers are spread. Levels are set so that a single shot peaks near 0.4 in the
// mix and a rapid fire train stays under 0.5 (measured with tools/sfxanalyze.mjs).
// ---------------------------------------------------------------------------------------------------------------------------------

/** Amplitude gated noise band (a rattle): band-passed noise times a square wave at o.rate Hz. o: {t, dur, vol, f, q, rate, depth} */
function rattle(e, dest, o) {
  const ac = e.ac, t = o.t;
  const src = ac.createBufferSource(); src.buffer = getNoise(ac).white; src.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = nyq(e, o.f); bp.Q.value = o.q ?? 2;
  const mod = ac.createGain(); mod.gain.value = 1 - o.depth * 0.5;
  const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = o.rate;
  const ld = ac.createGain(); ld.gain.value = o.depth * 0.5;
  lfo.connect(ld); ld.connect(mod.gain);
  const g = ac.createGain(); env(g.gain, t, 0.002, o.vol, o.dur);
  src.connect(bp); bp.connect(mod); mod.connect(g); g.connect(dest);
  src.start(t, e.r() * 1.5); lfo.start(t); src.stop(t + o.dur + 0.05); lfo.stop(t + o.dur + 0.05);
  src.onended = gone([src, bp, mod, lfo, ld, g]);
}

//
// Level 1 laser: crisp and bright. Short (about 90 ms) so 8 shots per second stay a clean tick pattern.
//
function laserBrightR1(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.95, 1.06), v = e.v * rr(e, 0.9, 1.1), col = e.r(), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 50, lp: 12000, sat: 1.9, post: 0.72 });   // a light soft clip keeps the click from setting the peak
  const comb = echo(e, out, { time: rr(e, 0.0031, 0.0041), fb: 0.55, lp: 7000, mix: 0.3 });
  const slap = echo(e, out, { time: 0.029, fb: 0.1, lp: 5200, mix: 0.1 });
  const S = bus(e, { sat: 2.4, post: 0.7, dest: out });
  const L = bus(e, { pan: -0.35 * side, dest: out }), R = bus(e, { pan: 0.35 * side, delay: 0.006, dest: out });
  // transient: a hard high click and a bright noise band, colour changes per shot
  noise(ac, out, { t, dur: 0.02, a: 0.0006, vol: 0.42 * v, type: 'highpass', f0: 5200 + col * 2600, offset: e.r() });
  noise(ac, out, { t, dur: 0.026, a: 0.0008, vol: 0.42 * v, type: 'bandpass', f0: 2800 + col * 2600, q: 0.9, offset: e.r() });
  // weight: a small thump so it is not only high
  tone(ac, S, { t, dur: 0.08, a: 0.0015, vol: 0.18 * v, type: 'sine', f0: 310 * p, f1: 92 * p, sweep: 0.5, hold: 0 });
  // body: a detuned saw pair falling through a closing resonant filter (the zap)
  for (const [bus_, det, k] of [[L, -9, 1], [R, 9, 0.8]]) {
    tone(ac, bus_, { t, dur: 0.095, a: 0.001, vol: 0.36 * k * v, type: 'sawtooth', f0: 4600 * p, f1: 780 * p, sweep: 0.75, hold: 0, detune: det, lp: 9000, lpEnd: 1300, q: 3 });
  }
  // glassy FM ping with a fast dying index
  fm(e, L, { t, dur: 0.075, a: 0.001, f0: 3400 * p, f1: 1000 * p, sweep: 0.6, vol: 0.5 * v, ratio: 3.5, depth: 3600, mdecay: 0.3, sends: [comb, slap] });
  fm(e, R, { t: t + 0.001, dur: 0.07, a: 0.001, f0: 2300 * p, f1: 620 * p, sweep: 0.7, vol: 0.4 * v, ratio: 1.414, depth: 2400, mdecay: 0.3, detune: 12 });
  // tail: a narrow resonant band sweeping down
  band(e, R, { t: t + 0.004, dur: 0.06, vol: 0.9 * v, f0: 5200 * p, f1: 1500 * p });
  return 0.14;
}

//
// Level 2 laser: gritty and industrial. Two barrels 32 ms apart. Each hit is a metal clank, a bit crushed saw growl over a sub, a ring
// modulated clang and a folded FM clatter; the first hit adds an amplitude gated rattle (pneumatic machinery).
//
function gritHitR1(e, out, S, sends, t, pan, p, v, full) {
  const ac = e.ac;
  const crush = bus(e, { gain: rr(e, 2.2, 3.2), curve: stepCurve(4 + Math.floor(e.r() * 3)), over: 'none', post: 0.5, dest: bus(e, { pan, lp: 4200, dest: out }) });
  const B = bus(e, { pan, dest: out });
  noise(ac, B, { t, dur: 0.03, a: 0.0008, vol: 0.5 * v, type: 'bandpass', f0: rr(e, 1300, 2600), q: 1.4, offset: e.r() });
  noise(ac, B, { t, dur: 0.012, a: 0.0006, vol: 0.4 * v, type: 'highpass', f0: 6000, offset: e.r() });
  tone(ac, S, { t, dur: 0.12, a: 0.002, vol: 0.08 * v, type: 'sine', f0: 135 * p, f1: 46 * p, sweep: 0.55, hold: 0 });
  tone(ac, crush, { t, dur: 0.11, a: 0.002, vol: 0.32 * v, type: 'sawtooth', f0: 178 * p, f1: 60 * p, sweep: 0.65, hold: 0, lp: 3600, lpEnd: 900, q: 2 });
  if (full) {
    const fold = bus(e, { gain: 1.8, curve: foldCurve(2.2), post: 0.4, dest: bus(e, { pan, hp: 500, lp: 7000, dest: out }) });
    tone(ac, fold, { t, dur: 0.09, a: 0.001, vol: 0.42 * v, type: 'sawtooth', f0: 520 * p, f1: 190 * p, sweep: 0.6, hold: 0, lp: 5000, lpEnd: 1400 });
    ring(e, B, { t, dur: 0.12, f0: 820 * p, f1: 300 * p, rf: 233 * p, rf1: 131 * p, vol: 0.34 * v, lp: 4600 });
    fm(e, B, { t, dur: 0.085, f0: 1900 * p, f1: 560 * p, sweep: 0.6, vol: 0.34 * v, ratio: 2.76, depth: 2600, mdecay: 0.3, sends });
    rattle(e, B, { t: t + 0.004, dur: 0.1, vol: 1.7 * v, f: rr(e, 1500, 2300), q: 2.2, rate: rr(e, 88, 104), depth: 0.9 });
  } else {
    fm(e, B, { t, dur: 0.07, f0: 1500 * p, f1: 480 * p, sweep: 0.6, vol: 0.2 * v, ratio: 2.76, depth: 2200, mdecay: 0.3, sends });
  }
}

function laserGritR1(e) {
  const { t } = e;
  const p = e.p * rr(e, 0.93, 1.07), v = e.v * rr(e, 0.88, 1.1), side = e.r() < 0.5 ? -1 : 1;
  const out = bus(e, { hp: 40, lp: 9500, sat: 1.7, post: 0.74 });   // soft clip: tames the clank peaks so the grit can sit louder
  const slap = echo(e, out, { time: 0.057, fb: 0.14, lp: 2800, mix: 0.13 });
  const comb = echo(e, out, { time: rr(e, 0.0034, 0.0046), fb: 0.5, lp: 4000, mix: 0.3 });
  const S = bus(e, { sat: 2.6, post: 0.62, dest: out });   // the sub is shared and stays in the centre
  gritHitR1(e, out, S, [slap, comb], t, -0.4 * side, p, v, true);
  gritHitR1(e, out, S, [slap, comb], t + 0.032 + rr(e, -0.004, 0.004), 0.4 * side, p * rr(e, 0.9, 1.1), v * 0.85, false);
  return 0.24;
}

//
// Level 3 laser: punchy and bass heavy. A mono sub thump that drops fast, a saturated second harmonic so it also reads on small
// speakers, a kick style click plus a defined crack, a growl for warmth, and a short low level ring so it still reads as energy.
// Dry with no tail: 5.6 shots per second must stay articulate.
//
function laserPunchR1(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.96, 1.05), v = e.v * rr(e, 0.92, 1.08), col = e.r();
  const out = bus(e, { hp: 28, lp: 9500, sat: 2.4, post: 0.66 });   // soft clip: the click no longer sets the peak, and the bass gains harmonics
  const ringIn = echo(e, out, { time: rr(e, 0.0031, 0.0041), fb: 0.55, lp: 5500, mix: 0.4 });
  const M = bus(e, { sat: 2.2, post: 0.66, dest: out });
  const Q = bus(e, { gain: 1.6, sat: 3.6, post: 0.55, dest: out });
  const L = bus(e, { pan: -0.5, dest: out }), R = bus(e, { pan: 0.5, delay: 0.004, dest: out });
  // the sub: a fast pitch drop, then a short body
  tone(ac, M, { t, dur: 0.17, a: 0.002, vol: 0.42 * v, type: 'sine', f0: 235 * p, f1: 56 * p, sweep: 0.5, hold: 0.06 });
  tone(ac, M, { t, dur: 0.075, a: 0.0015, vol: 0.5 * v, type: 'sine', f0: 560 * p, f1: 150 * p, sweep: 0.5, hold: 0 });
  // felt weight below the speakers of a laptop: a slow mono sub that only headphones and monitors reproduce in full
  tone(ac, M, { t, dur: 0.2, a: 0.004, vol: 0.26 * v, type: 'sine', f0: 92 * p, f1: 38 * p, sweep: 0.6, hold: 0.1 });
  // the growl: a saw through a closing low pass and hard saturation, this is what carries the bass on small speakers
  tone(ac, Q, { t, dur: 0.13, a: 0.002, vol: 0.2 * v, type: 'sawtooth', f0: 150 * p, f1: 62 * p, sweep: 0.6, hold: 0, lp: 1300, lpEnd: 260, q: 2 });
  // click and crack: a low thud, a defined mid crack and a short bright tick
  noise(ac, out, { t, dur: 0.05, a: 0.0008, vol: 1.3 * v, type: 'lowpass', f0: 1400, q: 0.7, offset: e.r() });
  noise(ac, out, { t, dur: 0.045, a: 0.0007, vol: 3.2 * v, type: 'bandpass', f0: 2300 + col * 2200, q: 0.85, offset: e.r() });
  noise(ac, out, { t, dur: 0.011, a: 0.0005, vol: 0.7 * v, type: 'highpass', f0: 6500, offset: e.r() });
  // punch mid: an FM pop
  fm(e, L, { t, dur: 0.065, a: 0.001, f0: 980 * p, f1: 300 * p, sweep: 0.6, vol: 0.7 * v, ratio: 1.5, depth: 2000, mdecay: 0.3 });
  // short ring: inharmonic partials, detuned left and right, fed into a 3 to 4 ms comb
  const f = 1150 * p;
  [[1, 0.1, 0.11], [2.76, 0.07, 0.07]].forEach(([r, d, vol], i) => {
    tone(ac, L, { t: t + 0.002, dur: d, a: 0.001, vol: vol * v, type: 'sine', f0: f * r * 0.994, hold: 0 });
    tone(ac, R, { t: t + 0.002, dur: d * 0.9, a: 0.001, vol: vol * 0.85 * v, type: 'sine', f0: f * r * 1.008, hold: 0 });
    if (i === 0) tone(ac, ringIn, { t: t + 0.002, dur: d, a: 0.001, vol: vol * 0.7 * v, type: 'sine', f0: f * r, hold: 0 });
  });
  return 0.19;
}



// The earlier player laser recipes (crisp, gritty, bass heavy, but built from separate layers without the classic falling sweep), kept for
// A/B in the sound lab and the offline comparison in tools/sfxanalyze.mjs. The playback path applies a fixed 0.75 gain to any recipe override,
// so they are pre-scaled by their old meta gain (0.5, 0.52, 0.4) to sound at the level they had in the game.
const scaled = (fn, k) => (e) => { const g = e.ac.createGain(); g.gain.value = k; g.connect(e.out); return fn({ ...e, out: g }); };
export const WEAPON_SFX_PREV = {
  laser: scaled(laserBrightR1, 0.5 / 0.75),
  laser2: scaled(laserGritR1, 0.52 / 0.75),
  laser3: scaled(laserPunchR1, 0.4 / 0.75),
};

export const WEAPON_SFX = {
  laser: laserBright,
  laser2: laserGrit,
  laser3: laserPunch,
  enemyLaser,
  turretLaser,
  bossCharge,
  bossCannon,
  bossBeam,
  allyLaser,
  allyBlip,

  // Lock-on charge: an energy build. Detuned saws rising through an opening resonant filter, a vibrato whine,
  // a pulsing noise band that speeds up, then a latch tick with a low thock.
  laserCharge(e) {
    const { ac, t } = e;
    const p = e.p, v = e.v, D = 0.78;
    const out = bus(e, { lp: 9000 });
    const swell = (g, vol) => {
      g.gain.setValueAtTime(vol * 0.05, t);
      g.gain.exponentialRampToValueAtTime(vol, t + D * 0.96);
      g.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.09);
    };
    const nodes = [];
    for (const [det, pan] of [[-9, -0.5], [9, 0.5]]) {
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(96 * p, t); o.frequency.exponentialRampToValueAtTime(520 * p, t + D);
      o.detune.value = det;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
      f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(nyq(e, 4200), t + D);
      const g = ac.createGain(); swell(g, 0.075 * v);
      o.connect(f); f.connect(g); g.connect(bus(e, { pan, dest: out }));
      o.start(t); o.stop(t + D + 0.15);
      nodes.push(o, f, g);
    }
    // whine with growing vibrato
    const w = ac.createOscillator(); w.type = 'sine';
    w.frequency.setValueAtTime(480 * p, t); w.frequency.exponentialRampToValueAtTime(2900 * p, t + D);
    const vib = ac.createOscillator(); vib.frequency.setValueAtTime(6, t); vib.frequency.exponentialRampToValueAtTime(28, t + D);
    const vd = ac.createGain(); vd.gain.setValueAtTime(6, t); vd.gain.linearRampToValueAtTime(70, t + D);
    vib.connect(vd); vd.connect(w.frequency);
    const wg = ac.createGain(); swell(wg, 0.04 * v);
    w.connect(wg); wg.connect(out);
    w.start(t); vib.start(t); w.stop(t + D + 0.15); vib.stop(t + D + 0.15);
    nodes.push(w, vib, vd, wg);
    // pulsing noise band, the gate gets faster as the energy builds
    const nb = ac.createBufferSource();
    nb.buffer = getNoise(ac).white; nb.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(nyq(e, 5200), t + D);
    const gate = ac.createGain(); gate.gain.value = 0.55;
    const lfo = ac.createOscillator(); lfo.frequency.setValueAtTime(7, t); lfo.frequency.exponentialRampToValueAtTime(26, t + D);
    const ld = ac.createGain(); ld.gain.value = 0.45;
    lfo.connect(ld); ld.connect(gate.gain);
    const ng = ac.createGain(); swell(ng, 0.13 * v);
    nb.connect(bp); bp.connect(gate); gate.connect(ng); ng.connect(out);
    nb.start(t, e.r()); lfo.start(t); nb.stop(t + D + 0.15); lfo.stop(t + D + 0.15);
    nodes.push(nb, bp, gate, lfo, ld, ng);
    nb.onended = gone(nodes);
    // sub swell
    tone(ac, out, { t, dur: D + 0.05, a: D * 0.8, vol: 0.09 * v, type: 'sine', f0: 52 * p, f1: 118 * p, sweep: 1, hold: 0 });
    // latch
    const lt = t + D + 0.005;
    noise(ac, out, { t: lt, dur: 0.03, a: 0.0015, vol: 0.2 * v, type: 'bandpass', f0: 3400, q: 1.1, offset: e.r() });
    tone(ac, out, { t: lt, dur: 0.16, a: 0.002, vol: 0.22 * v, type: 'sine', f0: 190 * p, f1: 70, sweep: 0.5, hold: 0 });
    tone(ac, out, { t: lt, dur: 0.09, a: 0.002, vol: 0.09 * v, type: 'sine', f0: 1480 * p, hold: 0 });
    return D + 0.22;
  },

  // Target ping: a crisp two-tone tick. Pitch rides e.p (the game steps it up with each consecutive lock).
  lockon(e) {
    const { ac, t } = e;
    const p = Math.min(e.p, 2.3), v = e.v * rr(e, 0.95, 1.05);
    const out = bus(e, { lp: 9000 });
    const ping = (dt, f, pan, vol) => {
      const tt = t + dt, B = bus(e, { pan, dest: out });
      noise(ac, B, { t: tt, dur: 0.02, a: 0.0015, vol: 0.13 * v, type: 'bandpass', f0: Math.min(6500, 3.4 * f), q: 1.2, offset: e.r() });
      fm(e, B, { t: tt, dur: 0.075, a: 0.002, f0: f, f1: f * 0.985, vol: 0.2 * v * vol, ratio: 2.01, depth: f * 0.9, mdecay: 0.25 });
      tone(ac, B, { t: tt, dur: 0.05, a: 0.002, vol: 0.07 * v * vol, type: 'triangle', f0: f * 2, hold: 0 });
      tone(ac, B, { t: tt + 0.005, dur: 0.13, a: 0.004, vol: 0.05 * v * vol, type: 'sine', f0: f * 3.01, hold: 0 });
    };
    ping(0, 988 * p, -0.2, 1);
    ping(0.062, 1480 * p, 0.2, 1.1);
    return 0.24;
  },

  // Homing volley launch: a barrage release. A crack and thump, then a stream of panned mini zaps that sweep
  // across the stereo field, a rising and falling whoosh and a long echoing saw tail.
  chargedShot(e) {
    const { ac, t } = e;
    const p = e.p * rr(e, 0.97, 1.03), v = e.v * rr(e, 0.95, 1.05);
    const out = bus(e, { lp: 9000 });
    const slap = echo(e, out, { time: 0.12, fb: 0.32, lp: 2400, mix: 0.24 });
    const comb = echo(e, out, { time: rr(e, 0.0034, 0.0046), fb: 0.5, lp: 3400, mix: 0.28 });
    const S = bus(e, { sat: 2.2, post: 0.65, dest: out });
    // launch: crack, blast, thump
    noise(ac, out, { t, dur: 0.03, a: 0.002, vol: 0.32 * v, type: 'bandpass', f0: 2600, q: 0.7, offset: e.r() });
    noise(ac, out, { t, dur: 0.36, a: 0.003, vol: 0.3 * v, type: 'lowpass', f0: 6000, f1: 300, q: 0.7, offset: e.r() });
    tone(ac, S, { t, dur: 0.3, a: 0.003, vol: 0.5 * v, type: 'sine', f0: 170 * p, f1: 46, sweep: 0.5, hold: 0 });
    tone(ac, S, { t, dur: 0.12, a: 0.002, vol: 0.14 * v, type: 'triangle', f0: 340 * p, f1: 110, sweep: 0.5, hold: 0 });
    // barrage of mini zaps, panned left to right, rising a little
    const n = 7;
    for (let i = 0; i < n; i++) {
      const dt = 0.012 + i * 0.045 * rr(e, 0.88, 1.12), k = i / (n - 1);
      const B = bus(e, { pan: -0.75 + 1.5 * k, dest: out });
      const fp = p * (1 + k * 0.28) * rr(e, 0.97, 1.03), vol = v * (1 - k * 0.3);
      noise(ac, B, { t: t + dt, dur: 0.02, a: 0.0015, vol: 0.13 * vol, type: 'bandpass', f0: rr(e, 3000, 5600), q: 0.9, offset: e.r() });
      fm(e, B, { t: t + dt, dur: 0.1, f0: 1500 * fp, f1: 430 * fp, sweep: 0.65, vol: 0.15 * vol, ratio: 1.414, depth: 1800, mdecay: 0.35, sends: i % 2 ? [comb] : [slap] });
      tone(ac, S, { t: t + dt, dur: 0.07, a: 0.002, vol: 0.13 * vol, type: 'sine', f0: 360 * fp, f1: 130 * fp, sweep: 0.55, hold: 0 });
    }
    // whoosh, two decorrelated bands, one each side
    for (const pan of [-0.6, 0.6]) {
      noise(ac, bus(e, { pan, dest: out }), { t: t + 0.02, dur: 0.62, a: 0.06, vol: 0.2 * v, type: 'bandpass', f0: 500, fmid: 4200, tmid: 0.3, f1: 600, q: 1.4, offset: e.r() });
    }
    // saw tail falling away
    tone(ac, out, { t, dur: 0.55, a: 0.01, vol: 0.1 * v, type: 'sawtooth', f0: 900 * p, f1: 80 * p, sweep: 0.9, hold: 0, lp: 3000, lpEnd: 300 });
    ring(e, bus(e, { pan: 0.3, dest: out }), { t: t + 0.03, dur: 0.4, f0: 640 * p, f1: 110 * p, rf: 233 * p, rf1: 120 * p, vol: 0.06 * v, lp: 3200 });
    return 1.0;
  },

  // Pulse bomb: cinematic detonation. Blast, deep sub boom with a punch layer, a wide shockwave sweep,
  // rolling rumble, scattered debris and a cavernous tail from a small feedback delay network.
  bomb(e) {
    const { ac, t } = e;
    const p = e.p, v = e.v;
    const out = bus(e, { lp: 12000 });
    const cave = bus(e, { gain: 0.55, dest: null });                   // reverb-like send: three detuned echo loops
    for (const [time, pan] of [[0.067, -0.6], [0.089, 0.6], [0.131, 0]]) {
      cave.connect(echo(e, bus(e, { pan, dest: out }), { time, fb: 0.62, lp: 1500, mix: 0.5 }));
    }
    const S = bus(e, { sat: 1.8, post: 0.8, dest: out });
    const B = bus(e, { dest: out }); B.connect(cave);
    // blast
    noise(ac, B, { t, dur: 0.03, a: 0.002, vol: 0.34 * v, type: 'bandpass', f0: 2400, q: 0.6, offset: e.r() });
    noise(ac, B, { t, dur: 0.55, a: 0.003, vol: 0.5 * v, type: 'lowpass', f0: 6500, f1: 180, q: 0.8, offset: e.r() });
    // sub boom and punch
    tone(ac, S, { t, dur: 1.9, a: 0.004, vol: 0.62 * v, type: 'sine', f0: 76 * p, f1: 24, sweep: 0.85, hold: 0 });
    tone(ac, S, { t, dur: 0.5, a: 0.003, vol: 0.5 * v, type: 'sine', f0: 150 * p, f1: 44, sweep: 0.45, hold: 0 });
    tone(ac, S, { t: t + 0.01, dur: 0.6, a: 0.003, vol: 0.14 * v, type: 'sawtooth', f0: 110 * p, f1: 34, sweep: 0.8, hold: 0, lp: 700, lpEnd: 120 });
    // shockwave: a wide noise sweep that opens up then dies, one band each side
    for (const pan of [-0.7, 0.7]) {
      const W = bus(e, { pan, dest: out }); W.connect(cave);
      noise(ac, W, { t: t + 0.04, dur: 1.3, a: 0.08, vol: 0.4 * v, type: 'bandpass', f0: 120, fmid: 3400, tmid: 0.32, f1: 160, q: 1.6, offset: e.r() });
    }
    // rumble with a slow wobble
    const rb = ac.createBufferSource(); rb.buffer = getNoise(ac).brown; rb.loop = true;
    const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.Q.value = 0.8;
    rl.frequency.setValueAtTime(900, t); rl.frequency.exponentialRampToValueAtTime(45, t + 2.2);
    const rg = ac.createGain(); env(rg.gain, t, 0.01, 0.55 * v, 2.3);
    const wob = ac.createOscillator(); wob.frequency.value = 8 + e.r() * 3;
    const wd = ac.createGain(); wd.gain.value = 0.14;
    const rw = ac.createGain(); rw.gain.value = 0.86;
    wob.connect(wd); wd.connect(rw.gain);
    rb.connect(rl); rl.connect(rg); rg.connect(rw); rw.connect(out); rw.connect(cave);
    rb.start(t, e.r()); wob.start(t); rb.stop(t + 2.4); wob.stop(t + 2.4);
    rb.onended = gone([rb, rl, rg, wob, wd, rw]);
    // debris
    crackle(e, [bus(e, { pan: -0.7, dest: out }), bus(e, { pan: 0.7, dest: out }), out], { t: t + 0.08, span: 1.4, n: 16, vol: 0.13 * v, f0: 1800, f1: 6500 });
    // late ring of the shockwave in the low mids
    band(e, out, { t: t + 0.15, dur: 1.2, vol: 0.5 * v, f0: 420, f1: 90, q: 4 });
    return 2.7;
  },

  // Barrel roll deflect: a struck metal ping (inharmonic partials with a quick upward chirp), a rising ricochet
  // zap, a comb shimmer and a panned whoosh.
  reflect(e) {
    const { ac, t } = e;
    const p = e.p * rr(e, 0.95, 1.06), v = e.v * rr(e, 0.92, 1.08);
    const side = e.r() < 0.5 ? -1 : 1;
    const out = bus(e, { lp: 10000 });
    const comb = echo(e, out, { time: rr(e, 0.0031, 0.0042), fb: 0.6, lp: 5000, mix: 0.4 });
    const M = bus(e, { pan: side * 0.25, dest: out }); M.connect(comb);
    noise(ac, M, { t, dur: 0.02, a: 0.0015, vol: 0.26 * v, type: 'highpass', f0: 4800, offset: e.r() });
    noise(ac, M, { t, dur: 0.03, a: 0.002, vol: 0.14 * v, type: 'bandpass', f0: 2400, q: 0.9, offset: e.r() });
    const f = 1240 * p;
    [[1, 0.34, 0.2], [2.32, 0.2, 0.11], [4.25, 0.12, 0.07], [6.63, 0.07, 0.04]].forEach(([r, d, vol]) => {
      tone(ac, M, { t, dur: d, a: 0.0015, vol: vol * v, type: 'sine', f0: f * r * 0.94, f1: f * r, sweep: 0.08, hold: 0 });
    });
    fm(e, bus(e, { pan: -side * 0.3, dest: out }), { t: t + 0.004, dur: 0.11, f0: 620 * p, f1: 2500 * p, sweep: 0.55, vol: 0.13 * v, ratio: 1.5, depth: 1400, mdecay: 0.4, sends: [comb] });
    // whoosh sweeping across the field
    const wsrc = bus(e, { dest: null });
    if (ac.createStereoPanner) {
      const pn = ac.createStereoPanner();
      pn.pan.setValueAtTime(side * 0.7, t); pn.pan.linearRampToValueAtTime(-side * 0.7, t + 0.3);
      pn.connect(out); wsrc.connect(pn);
    } else wsrc.connect(out);
    noise(ac, wsrc, { t, dur: 0.32, a: 0.03, vol: 0.2 * v, type: 'bandpass', f0: 700, fmid: 3400, tmid: 0.4, f1: 1100, q: 1.1, offset: e.r() });
    return 0.5;
  },
};

// name -> {gap: min seconds between plays, max: concurrent voices, prio, group: dedupe group, gain}
// laser2 and laser3 share the group of laser so that an event driven laser2 does not double a direct laser call.
export const WEAPON_META = {
  laser: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.26 },
  laser2: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.16 },
  laser3: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.19 },
  enemyLaser: { gap: 0.05, max: 5, prio: 1, gain: 0.17 },
  turretLaser: { gap: 0.15, max: 3, prio: 2, gain: 0.2 },
  bossCharge: { gap: 0.4, max: 2, prio: 3, gain: 0.8 },
  bossCannon: { gap: 0.3, max: 2, prio: 4, gain: 0.7 },
  bossBeam: { gap: 0.5, max: 2, prio: 4, gain: 0.7 },
  allyLaser: { gap: 0.07, max: 3, prio: 0, gain: 0.95 },
  allyBlip: { gap: 0.08, max: 2, prio: 0, gain: 0.9 },
  laserCharge: { gap: 0.2, max: 1, prio: 2, gain: 0.85 },
  lockon: { gap: 0.05, max: 6, prio: 2, gain: 0.9 },
  chargedShot: { gap: 0.1, max: 2, prio: 3, gain: 0.72 },
  bomb: { gap: 0.3, max: 1, prio: 5, gain: 0.8 },
  reflect: { gap: 0.06, max: 3, prio: 3, gain: 1.1 },
};
