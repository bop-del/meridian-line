// Weapon sound effects Same recipe format as ../sfx.js: fn(e) with
// e = {ac, out, t, v, p, r} returns the duration in seconds; META entries set voice limits per name.
// Names defined here override the legacy recipes in ../sfx.js.
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

/**
 * A small processing bus. Returns its input node; the chain is gain, [highpass], [lowpass], [saturator],
 * [delay], [pan] and ends at o.dest (default e.out, null leaves the end open for the caller).
 * o: {gain, hp, lp, sat, post, delay, pan, dest}
 */
function bus(e, o = {}) {
  const ac = e.ac;
  const input = ac.createGain();
  input.gain.value = o.gain ?? 1;
  let tail = input;
  const add = (n) => { tail.connect(n); tail = n; };
  if (o.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = nyq(e, o.hp); f.Q.value = 0.6; add(f); }
  if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = nyq(e, o.lp); f.Q.value = 0.5; add(f); }
  if (o.sat) {
    const s = ac.createWaveShaper(); s.curve = satCurve(o.sat); s.oversample = '2x'; add(s);
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

/** One barrel of the twin shot (laser2). */
function twinHit(e, out, sends, t, pan, p, v) {
  const S = bus(e, { pan, sat: 2.4, post: 0.62, dest: out });
  const B = bus(e, { pan, dest: out });
  noise(e.ac, B, { t, dur: 0.02, a: 0.001 + e.r() * 0.002, vol: 0.42 * v, type: 'bandpass', f0: rr(e, 2200, 5200), q: 0.8, offset: e.r() });
  tone(e.ac, S, { t, dur: 0.13, a: 0.002, vol: 0.28 * v, type: 'sine', f0: 310 * p, f1: 108 * p, sweep: 0.5, hold: 0 });
  tone(e.ac, S, { t, dur: 0.075, a: 0.002, vol: 0.11 * v, type: 'triangle', f0: 620 * p, f1: 216 * p, sweep: 0.5, hold: 0 });
  tone(e.ac, S, { t, dur: 0.1, a: 0.003, vol: 0.11 * v, type: 'sawtooth', f0: 170 * p, f1: 72 * p, sweep: 0.7, hold: 0, lp: 1300, lpEnd: 380 });
  fm(e, B, { t, dur: 0.115, f0: 1500 * p, f1: 400 * p, sweep: 0.65, vol: 0.25 * v, ratio: 1.5, depth: 2600, mdecay: 0.32, sends });
  ring(e, B, { t, dur: 0.085, f0: 1150 * p, f1: 320 * p, rf: 331 * p, rf1: 160 * p, vol: 0.11 * v, lp: 4200 });
}

//
// Level 3 laser (hyper): plasma cannon punch. About 60 ms sub thump under a sharp bright crack and a short metallic ring,
// dry with no tail so 5.6 shots per second stay articulate. Variation per call comes only from e.r().
//
function laser3Recipe(e) {
  const { ac, t } = e;
  const p = e.p * rr(e, 0.96, 1.05), v = e.v * TRIM_L3, col = e.r();
  const out = bus(e, { hp: 45, lp: 9000 });
  const ringIn = echo(e, out, { time: rr(e, 0.0031, 0.0041), fb: 0.6, lp: 6500, mix: 0.5 });
  const S = bus(e, { sat: 3, post: 0.62, dest: out });
  const L = bus(e, { pan: -0.5, dest: out }), R = bus(e, { pan: 0.5, delay: 0.004, dest: out });
  const vv = v * rr(e, 0.92, 1.08);
  // the thump, short and tight, with a saturated upper harmonic so it still reads on small speakers
  tone(ac, S, { t, dur: 0.065, a: 0.002, vol: 0.16 * vv, type: 'sine', f0: 240 * p, f1: 84 * p, sweep: 0.5, hold: 0 });
  // the crack: a mid-high noise band and a bright tick, colour changes per shot
  noise(ac, out, { t, dur: 0.02, a: 0.0008, vol: 0.8 * vv, type: 'bandpass', f0: 2600 + col * 2400, q: 0.85, offset: e.r() });
  noise(ac, out, { t, dur: 0.012, a: 0.0006, vol: 0.3 * vv, type: 'highpass', f0: 6500, offset: e.r() });
  // the punch: a short FM pop that carries the mids
  fm(e, L, { t, dur: 0.06, a: 0.001, f0: 1050 * p, f1: 340 * p, sweep: 0.6, vol: 0.3 * vv, ratio: 1.5, depth: 2200, mdecay: 0.3 });
  // the ring: three inharmonic partials, detuned left and right, fed into a 3 to 4 ms comb
  const f = 1290 * p;
  [[1, 0.17, 0.2], [2.76, 0.11, 0.12], [5.4, 0.07, 0.05]].forEach(([r, d, vol], i) => {
    tone(ac, L, { t: t + 0.002, dur: d, a: 0.001, vol: vol * vv, type: 'sine', f0: f * r * 0.994, hold: 0 });
    tone(ac, R, { t: t + 0.002, dur: d * 0.9, a: 0.001, vol: vol * 0.85 * vv, type: 'sine', f0: f * r * 1.008, hold: 0 });
    if (i === 0) tone(ac, ringIn, { t: t + 0.002, dur: d, a: 0.001, vol: vol * 0.7 * vv, type: 'sine', f0: f * r, hold: 0 });
  });
  return 0.15;
}

// b: rail crack. Stage one (crack and snap) at t, stage two (boom) 15 to 25 ms later. Dry.

// c: ion burst rip. Three 10 to 14 ms pulses with a rising chirp, a zip sweep over the top, a short electric tail.

// d: cinematic blaster. Noise burst, pitch dropping body, a doppler whoosh that crosses the field, a slapback.

// Output trim that puts the level 3 laser at the loudness of the other pulse levels (measured with the offline harness).
const TRIM_L3 = 1.35;


export const WEAPON_SFX = {
  // Level 1: tight and light. Click, a short punchy body, one bright metallic zap and a small crackle band.
  laser(e) {
    const { ac, t } = e;
    const p = e.p * rr(e, 0.95, 1.06), v = e.v * rr(e, 0.9, 1.1), col = e.r();
    const out = bus(e, { lp: 8500 });
    const L = bus(e, { pan: -0.3, dest: out }), R = bus(e, { pan: 0.3, delay: 0.007, dest: out });
    const S = bus(e, { sat: 2, post: 0.7, dest: out });
    const comb = echo(e, out, { time: rr(e, 0.0032, 0.0042), fb: 0.5, lp: 3800, mix: 0.4 });
    noise(ac, out, { t, dur: 0.02, a: 0.001 + col * 0.002, vol: 0.5 * v, type: 'bandpass', f0: 2600 + col * 3400, q: 0.8, offset: e.r() });
    tone(ac, S, { t, dur: 0.09, a: 0.002, vol: 0.3 * v, type: 'sine', f0: 420 * p, f1: 140 * p, sweep: 0.55, hold: 0 });
    fm(e, L, { t, dur: 0.105, f0: 1750 * p, f1: 500 * p, sweep: 0.65, vol: 0.27 * v, ratio: 1.414, depth: 2000, mdecay: 0.35, sends: [comb] });
    fm(e, R, { t, dur: 0.095, f0: 1750 * 1.004 * p, f1: 500 * p, sweep: 0.65, vol: 0.17 * v, ratio: 1.414, depth: 1800, mdecay: 0.35, detune: 14 });
    band(e, R, { t: t + 0.004, dur: 0.055, vol: 1.0 * v, f0: 3800 * p, f1: 1700 * p });
    return 0.17;
  },

  // Level 2: twin barrels. Two staggered, panned hits, each thicker (harmonic body, saw growl, ring mod), plus a slapback.
  laser2(e) {
    const { t } = e;
    const p = e.p * rr(e, 0.95, 1.05), v = e.v * rr(e, 0.9, 1.1);
    const out = bus(e, { lp: 7500 });
    const slap = echo(e, out, { time: 0.058, fb: 0.15, lp: 2600, mix: 0.15 });
    const comb = echo(e, out, { time: rr(e, 0.0034, 0.0046), fb: 0.5, lp: 3400, mix: 0.35 });
    twinHit(e, out, [slap, comb], t, -0.42, p, v);
    twinHit(e, out, [slap, comb], t + 0.03 + rr(e, -0.004, 0.004), 0.42, p * 1.06, v * 0.85);
    return 0.26;
  },

  // Level 3: hyper. Plasma cannon punch (see laser3Recipe above).
  laser3(e) { return laser3Recipe(e); },

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

  // Smart bomb: cinematic detonation. Blast, deep sub boom with a punch layer, a wide shockwave sweep,
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
  laser: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.8 },
  laser2: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.78 },
  laser3: { gap: 0.045, max: 4, prio: 1, group: 'laser', gain: 0.72 },
  laserCharge: { gap: 0.2, max: 1, prio: 2, gain: 0.85 },
  lockon: { gap: 0.05, max: 6, prio: 2, gain: 0.9 },
  chargedShot: { gap: 0.1, max: 2, prio: 3, gain: 0.72 },
  bomb: { gap: 0.3, max: 1, prio: 5, gain: 0.8 },
  reflect: { gap: 0.06, max: 3, prio: 3, gain: 1.1 },
};
