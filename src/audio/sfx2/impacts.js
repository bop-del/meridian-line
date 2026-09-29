// Impact and pickup sound effects (owned by the impacts sound agent). Same recipe format as ../sfx.js:
// fn(e) with e = {ac, out, t, v, p, r} returns the duration in seconds; META entries set voice limits per name.
// Names defined here override the legacy recipes in ../sfx.js.
//
// Design: every sound is layered. A very short noise transient, a low body with a fast pitch drop, texture layers
// (band passed noise, ring modulation, a short comb), stereo width from decorrelated noise and detuned voices, and a tail
// (slapback echo or a small generated reverb). All variation comes from e.r() so repeats never sound identical.
// Explosions share a per-context "crowd" counter that thins out the low end when many overlap, so chain reactions
// and boss death sequences stay tight instead of turning into mud.
import { tone, noise, getNoise } from '../synth.js';

const rr = (e, a, b) => a + e.r() * (b - a);
const N = (e, out, o) => noise(e.ac, out, { offset: e.r(), ...o });
const T = (e, out, o) => tone(e.ac, out, o);

/** Sum bus: gain (optionally panned) into out, optionally also into a send node (reverb or echo input). */
function bus(e, out, pan = 0, gain = 1, send = null) {
  const g = e.ac.createGain();
  g.gain.value = gain;
  if (pan && e.ac.createStereoPanner) {
    const p = e.ac.createStereoPanner();
    p.pan.value = pan;
    g.connect(p); p.connect(out);
  } else g.connect(out);
  if (send) g.connect(send);
  return g;
}

/** Ring modulated voice: a source (oscillator or noise) multiplied by a sine, bandpassed, with an exponential envelope. */
function ring(e, out, o) {
  const ac = e.ac, t = o.t, dur = Math.max(0.03, o.dur), vol = Math.max(0.0002, o.vol), a = Math.min(o.a ?? 0.003, dur * 0.5);
  let src;
  if (o.noise) {
    src = ac.createBufferSource(); src.buffer = getNoise(ac).white; src.loop = true;
    src.start(t, e.r() * 1.5);
  } else {
    src = ac.createOscillator(); src.type = o.type || 'sawtooth';
    src.frequency.setValueAtTime(o.f0, t);
    if (o.f1) src.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    src.start(t);
  }
  const mod = ac.createOscillator(); mod.type = 'sine';
  mod.frequency.setValueAtTime(o.mod, t);
  if (o.mod1) mod.frequency.exponentialRampToValueAtTime(o.mod1, t + dur);
  const rm = ac.createGain(); rm.gain.value = 0;
  mod.connect(rm.gain);
  const bp = ac.createBiquadFilter(); bp.type = o.filter || 'bandpass'; bp.frequency.value = o.bp ?? 1200; bp.Q.value = o.q ?? 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(rm); rm.connect(bp); bp.connect(g); g.connect(out);
  mod.start(t);
  const end = t + dur + 0.05;
  src.stop(end); mod.stop(end);
  const list = [src, mod, rm, bp, g];
  src.onended = () => { for (const n of list) { try { n.disconnect(); } catch (err) { /* gone */ } } };
}

/** Two operator FM voice (bell, glass). Modulation index decays faster than the amplitude. */
function fm(e, out, o) {
  const ac = e.ac, t = o.t, dur = Math.max(0.03, o.dur), vol = Math.max(0.0002, o.vol), a = Math.min(o.a ?? 0.003, dur * 0.5);
  const car = ac.createOscillator(); car.type = 'sine'; car.frequency.value = o.f;
  const mod = ac.createOscillator(); mod.type = 'sine'; mod.frequency.value = o.f * o.ratio;
  const mg = ac.createGain();
  mg.gain.setValueAtTime(o.f * o.idx, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.5, o.f * o.idx * 0.02), t + dur * (o.idxDecay ?? 0.5));
  mod.connect(mg); mg.connect(car.frequency);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(g); g.connect(out);
  car.start(t); mod.start(t);
  car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  car.onended = () => { for (const n of [car, mod, mg, g]) { try { n.disconnect(); } catch (err) { /* gone */ } } };
}

/** Feedback echo (slapback when short). Returns the input node. */
function echo(e, out, time, fb, lp, wet, pan = 0) {
  const ac = e.ac;
  const inp = ac.createGain();
  const d = ac.createDelay(1); d.delayTime.value = time;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
  const g = ac.createGain(); g.gain.value = fb;
  inp.connect(d); d.connect(f); f.connect(g); g.connect(d);
  const w = bus(e, out, pan, wet);
  f.connect(w);
  return inp;
}

/** Short resonant comb burst: a noise click through a feedback delay rings at hz (metallic "tink"). */
function comb(e, out, t, hz, fb, vol, dur) {
  const ac = e.ac;
  const src = ac.createBufferSource(); src.buffer = getNoise(ac).white; src.loop = true;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.0015);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  const d = ac.createDelay(0.05); d.delayTime.value = 1 / hz;
  const g = ac.createGain(); g.gain.value = fb;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
  const o = ac.createGain();
  o.gain.setValueAtTime(1, t);
  o.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(env); env.connect(d); env.connect(o);
  d.connect(lp); lp.connect(g); g.connect(d); lp.connect(o);
  o.connect(out);
  src.start(t, e.r() * 1.5); src.stop(t + dur + 0.05);
  src.onended = () => { for (const n of [src, env, d, g, lp, o]) { try { n.disconnect(); } catch (err) { /* gone */ } } };
}

const irCache = new WeakMap();
/** Generated stereo impulse response: decaying noise that darkens over time (cached per context). */
function impulse(ac, sec) {
  let m = irCache.get(ac);
  if (!m) irCache.set(ac, (m = {}));
  const key = sec.toFixed(2);
  if (m[key]) return m[key];
  const sr = ac.sampleRate, len = Math.floor(sr * sec);
  const buf = ac.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 9871 + c * 7919, y = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed / 2147483648 - 1, k = 0.65 * Math.exp(-3 * i / len) + 0.04;
      y += (x - y) * k;
      d[i] = y * Math.exp((-6.9 * i) / len) * Math.min(1, i / (sr * 0.004));
    }
  }
  m[key] = buf;
  return buf;
}
function reverb(e, out, sec, wet) {
  const ac = e.ac;
  const inp = ac.createGain();
  const conv = ac.createConvolver(); conv.buffer = impulse(ac, sec);
  const w = ac.createGain(); w.gain.value = wet;
  inp.connect(conv); conv.connect(w); w.connect(out);
  return inp;
}

/** Scattered short bandpassed noise grains (debris, sparks) from one source with scheduled automation. */
function grains(e, out, o) {
  const ac = e.ac;
  const src = ac.createBufferSource(); src.buffer = getNoise(ac).white; src.loop = true;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
  const g = ac.createGain(); g.gain.value = 0.0001;
  src.connect(f); f.connect(g); g.connect(out);
  const last = o.t + o.start + o.span + 0.1;
  const list = [];
  for (let i = 0; i < o.count; i++) {
    const u = Math.pow(e.r(), o.skew ?? 1.6);
    list.push([o.t + o.start + u * o.span, u]);
  }
  list.sort((a, b) => a[0] - b[0]);   // automation events must be scheduled in time order
  for (const [at, u] of list) {
    const len = rr(e, 0.008, 0.035);
    f.frequency.setValueAtTime(rr(e, o.lo, o.hi), at);
    f.Q.setValueAtTime(rr(e, 2, 9), at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.vol * Math.exp(-u * 1.6) * rr(e, 0.5, 1), at + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  }
  src.start(o.t, e.r() * 1.5); src.stop(last + 0.05);
  src.onended = () => { for (const n of [src, f, g]) { try { n.disconnect(); } catch (err) { /* gone */ } } };
}

const boomLog = new WeakMap();
/** 1 for a lone explosion, dropping towards 0.3 as more start within `span` seconds. Scales the low end only. */
function crowd(e, span) {
  let a = boomLog.get(e.ac);
  if (!a) boomLog.set(e.ac, (a = []));
  const n = a.filter((x) => e.t - x < span && e.t - x > -0.02).length;
  a.push(e.t);
  if (a.length > 16) a.shift();
  return 1 / (1 + 0.6 * n);
}

export const IMPACT_SFX = {
  // Hostile bolt: a rising, buzzy, mid low chirp. The player's lasers fall from bright to dark, so the direction,
  // register (about 250 to 600 Hz) and the amplitude modulated grit make it a different, readable threat cue.
  enemyShot(e) {
    const p = e.p * rr(e, 0.93, 1.07), v = e.v, t = e.t, dur = 0.19;
    const out = e.out;
    const L = bus(e, out, -0.3), R = bus(e, out, 0.3);
    T(e, L, { t, dur, vol: 0.085 * v, type: 'sawtooth', f0: 250 * p, f1: 560 * p, sweep: 0.55, lp: 1900, q: 3, detune: 9, a: 0.006 });
    T(e, R, { t, dur, vol: 0.085 * v, type: 'sawtooth', f0: 250 * p, f1: 560 * p, sweep: 0.55, lp: 1900, q: 3, detune: -9, a: 0.006 });
    ring(e, out, { t, dur: 0.16, vol: 0.1 * v, type: 'square', f0: 330 * p, f1: 640 * p, mod: 86 * p, bp: 1300, q: 0.9, a: 0.004 });
    T(e, out, { t, dur: 0.13, vol: 0.15 * v, type: 'sine', f0: 190 * p, f1: 92 * p, sweep: 0.7, a: 0.004 });
    N(e, out, { t, dur: 0.022, vol: 0.075 * v, type: 'bandpass', f0: 1700, q: 2.5 });
    return dur + 0.03;
  },

  // Laser hitting an enemy: a bright tick, a short noise click and a small body with a fast drop, plus a tiny metal ping.
  hit(e) {
    const p = e.p * rr(e, 0.92, 1.08), v = e.v, t = e.t;
    const out = e.out;
    const L = bus(e, out, -0.35), R = bus(e, out, 0.35);
    N(e, L, { t, dur: 0.014, vol: 0.13 * v, type: 'highpass', f0: 3400 });
    N(e, R, { t: t + 0.0012, dur: 0.014, vol: 0.13 * v, type: 'highpass', f0: 3400 });
    N(e, out, { t, dur: 0.045, vol: 0.2 * v, type: 'bandpass', f0: 2500 * p, f1: 1400 * p, q: 2.2 });
    T(e, out, { t, dur: 0.075, vol: 0.24 * v, type: 'sine', f0: 400 * p, f1: 125 * p, sweep: 0.8, a: 0.002 });
    T(e, L, { t, dur: 0.1, vol: 0.05 * v, type: 'sine', f0: 1250 * p });
    T(e, R, { t, dur: 0.055, vol: 0.03 * v, type: 'sine', f0: 1250 * p * 2.76 });
    return 0.16;
  },

  // Heavier armoured hit: a metallic ring made of inharmonic partials and a ring modulated crunch over a low thump.
  bossHit(e) {
    const p = e.p * rr(e, 0.95, 1.05), v = e.v, t = e.t;
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.085, 0.3, 1800, 0.3);
    const send = bus(e, slap, 0, 0.7);
    const L = bus(e, mix, -0.4, 1, send), R = bus(e, mix, 0.4, 1, send);
    const base = 205 * p;
    [[1, 0.5, 0.15, L], [1.5, 0.42, 0.1, R], [2.32, 0.34, 0.09, L], [3.13, 0.26, 0.07, R], [4.18, 0.18, 0.045, L], [5.4, 0.12, 0.03, R]]
      .forEach(([r, d, vol, bs]) => T(e, bs, { t, dur: d, vol: vol * v, type: 'sine', f0: base * r * rr(e, 0.995, 1.005), a: 0.002 }));
    ring(e, mix, { t, dur: 0.16, vol: 0.2 * v, type: 'sawtooth', f0: 260 * p, f1: 150 * p, mod: 173, bp: 1500, q: 0.8 });
    N(e, mix, { t, dur: 0.02, vol: 0.2 * v, type: 'highpass', f0: 2200 });
    N(e, mix, { t, dur: 0.11, vol: 0.2 * v, type: 'bandpass', f0: 2600, f1: 700, q: 1.2 });
    T(e, mix, { t, dur: 0.24, vol: 0.34 * v, type: 'sine', f0: 118 * p, f1: 48, sweep: 0.8, shape: 10, hp: 28 });
    comb(e, mix, t, 340 * p, 0.7, 0.06 * v, 0.12);
    return 0.62;
  },

  // Small enemy blast: crack, noise puff that closes down, punchy body, a little ring modulated grit, debris and a slapback.
  explosion(e) {
    const p = e.p * rr(e, 0.94, 1.06), v = e.v, t = e.t;
    const cw = crowd(e, 0.45);
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.07, 0.28, 1700, 0.28);
    const send = bus(e, slap, 0, 0.8);
    const L = bus(e, mix, -0.5, 1, send), R = bus(e, mix, 0.5, 1, send), C = bus(e, mix, 0, 1, send);
    N(e, C, { t, dur: 0.03, vol: 0.4 * v, type: 'highpass', f0: 1300 });
    N(e, L, { t, dur: 0.16, vol: 0.32 * v, type: 'bandpass', f0: 3400 * p, f1: 800, q: 0.8 });
    N(e, R, { t: t + 0.006, dur: 0.16, vol: 0.32 * v, type: 'bandpass', f0: 3000 * p, f1: 700, q: 0.8 });
    N(e, L, { t, dur: rr(e, 0.5, 0.62), vol: 0.34 * v, type: 'lowpass', f0: 3600 * p, f1: 200, q: 0.8 });
    N(e, R, { t: t + 0.004, dur: rr(e, 0.5, 0.62), vol: 0.34 * v, type: 'lowpass', f0: 3300 * p, f1: 180, q: 0.8 });
    T(e, C, { t, dur: 0.3, vol: 0.5 * Math.sqrt(cw) * v, type: 'sine', f0: 150 * p, f1: 46, sweep: 0.55, shape: 14, hp: 32, a: 0.002 });
    T(e, C, { t: t + 0.01, dur: 0.5, vol: 0.28 * cw * v, type: 'sine', f0: 70, f1: 34, a: 0.012, hp: 28 });
    ring(e, C, { t, dur: 0.22, vol: 0.14 * v, type: 'sawtooth', f0: 230 * p, f1: 90 * p, mod: rr(e, 150, 200), bp: 900, q: 1.3 });
    comb(e, C, t + 0.004, rr(e, 260, 340), 0.72, 0.05 * v, 0.14);
    grains(e, R, { t, start: 0.06, span: 0.4, count: 5, vol: 0.06 * v, lo: 2500, hi: 6500, skew: 1.3 });
    grains(e, L, { t, start: 0.09, span: 0.4, count: 4, vol: 0.05 * v, lo: 2000, hi: 5500, skew: 1.3 });
    return 1.0;
  },

  // Large blast, layered: initial crack, low thump with sub, fireball noise, gritty mids, debris rain, rumble tail in a small reverb.
  bigExplosion(e) {
    const p = e.p * rr(e, 0.95, 1.05), v = e.v, t = e.t;
    const cw = crowd(e, 1.0);
    const mix = bus(e, e.out, 0);
    const send = reverb(e, mix, 1.5, 0.55);
    const L = bus(e, mix, -0.55, 1, send), R = bus(e, mix, 0.55, 1, send), C = bus(e, mix, 0, 1, send);
    // crack
    N(e, L, { t, dur: 0.04, vol: 0.5 * v, type: 'highpass', f0: 900 });
    N(e, R, { t: t + 0.011, dur: 0.04, vol: 0.5 * v, type: 'highpass', f0: 900 });
    N(e, C, { t, dur: 0.14, vol: 0.4 * v, type: 'bandpass', f0: 2600, f1: 500, q: 0.7 });
    // fireball, decorrelated left and right
    N(e, L, { t, dur: rr(e, 0.95, 1.15), vol: 0.42 * v, type: 'lowpass', f0: 6000, f1: 170, q: 0.8 });
    N(e, R, { t: t + 0.007, dur: rr(e, 0.95, 1.15), vol: 0.42 * v, type: 'lowpass', f0: 5200, f1: 150, q: 0.8 });
    // thump and sub
    T(e, C, { t, dur: 0.5, vol: 0.62 * Math.sqrt(cw) * v, type: 'sine', f0: 165 * p, f1: 40, sweep: 0.55, shape: 16, hp: 26, a: 0.002 });
    T(e, C, { t: t + 0.012, dur: 1.5, vol: 0.5 * cw * v, type: 'sine', f0: 64 * p, f1: 27, sweep: 0.9, hp: 24, a: 0.02 });
    // gritty mids
    N(e, C, { t: t + 0.02, dur: 1.6, vol: 0.46 * Math.sqrt(cw) * v, type: 'bandpass', f0: 760, f1: 85, q: 0.9, buf: 'brown', a: 0.012 });
    ring(e, C, { t, dur: 0.75, vol: 0.2 * v, type: 'sawtooth', f0: 110 * p, f1: 44 * p, mod: 143, bp: 600, q: 0.9, a: 0.01 });
    comb(e, L, t + 0.006, 230, 0.78, 0.08 * v, 0.22);
    comb(e, R, t + 0.02, 310, 0.78, 0.07 * v, 0.2);
    // debris rain
    grains(e, L, { t, start: 0.25, span: 1.9, count: 22, vol: 0.085 * v, lo: 900, hi: 6500 });
    grains(e, R, { t, start: 0.3, span: 1.9, count: 22, vol: 0.085 * v, lo: 900, hi: 6500 });
    for (let i = 0; i < 5; i++) {
      const at = t + 0.3 + Math.pow(e.r(), 1.4) * 1.7;
      T(e, i % 2 ? L : R, { t: at, dur: rr(e, 0.05, 0.12), vol: 0.022 * v, type: 'sine', f0: rr(e, 1600, 4200), a: 0.001 });
    }
    // rumble tail
    N(e, C, { t: t + 0.1, dur: 2.5, vol: 0.5 * Math.sqrt(cw) * v, type: 'lowpass', f0: 420, f1: 46, q: 0.7, buf: 'brown', a: 0.08 });
    return 2.6;
  },

  // Player takes a hit: a crunchy impact that closes down like a low pass "duck", with a low ring-down. No alarm tones.
  damage(e) {
    const p = e.p * rr(e, 0.95, 1.05), v = e.v, t = e.t;
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.055, 0.3, 1400, 0.25);
    const duck = e.ac.createBiquadFilter(); duck.type = 'lowpass'; duck.Q.value = 0.9;
    duck.frequency.setValueAtTime(12000, t);
    duck.frequency.exponentialRampToValueAtTime(1800, t + 0.07);
    duck.frequency.exponentialRampToValueAtTime(420, t + 0.5);
    duck.connect(mix); duck.connect(slap);
    const L = bus(e, duck, -0.4), R = bus(e, duck, 0.4), C = bus(e, duck, 0);
    N(e, L, { t, dur: 0.05, vol: 0.5 * v, type: 'highpass', f0: 1000 });
    N(e, R, { t: t + 0.006, dur: 0.05, vol: 0.5 * v, type: 'highpass', f0: 1000 });
    N(e, C, { t, dur: 0.32, vol: 0.42 * v, type: 'bandpass', f0: 1700, f1: 230, q: 1.8 });
    T(e, L, { t, dur: 0.4, vol: 0.3 * v, type: 'sawtooth', f0: 250 * p, f1: 58, sweep: 0.7, shape: 70, detune: 12 });
    T(e, R, { t, dur: 0.4, vol: 0.3 * v, type: 'sawtooth', f0: 250 * p, f1: 58, sweep: 0.7, shape: 70, detune: -12 });
    ring(e, C, { t, dur: 0.26, vol: 0.22 * v, type: 'sawtooth', f0: 320 * p, f1: 120 * p, mod: rr(e, 88, 110), bp: 1100, q: 1 });
    T(e, C, { t, dur: 0.38, vol: 0.55 * v, type: 'sine', f0: 100, f1: 34, sweep: 0.7, shape: 10, hp: 26 });
    T(e, C, { t, dur: 0.2, vol: 0.16 * v, type: 'sine', f0: 430 * p, f1: 95 * p, sweep: 0.8 });
    comb(e, C, t + 0.003, rr(e, 380, 460), 0.7, 0.05 * v, 0.1);
    return 0.62;
  },

  // Generic item pickup: a soft two note glass chime (a fifth up) with a warm octave below, an airy sweep and a slapback.
  pickup(e) {
    const p = e.p * rr(e, 0.985, 1.015), v = e.v, t = e.t + rr(e, 0, 0.004);
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.09, 0.3, 3800, 0.24, 0.25);
    const send = bus(e, slap, 0, 0.7);
    const L = bus(e, mix, -0.28, 1, send), R = bus(e, mix, 0.28, 1, send), C = bus(e, mix, 0, 1, send);
    const f1 = 784 * p, f2 = f1 * 1.5;
    fm(e, L, { t, dur: 0.3, vol: 0.085 * v, f: f1 * 0.9975, ratio: 2, idx: 1.4, a: 0.004 });
    fm(e, R, { t, dur: 0.3, vol: 0.085 * v, f: f1 * 1.0025, ratio: 2, idx: 1.4, a: 0.004 });
    fm(e, L, { t: t + 0.07, dur: 0.45, vol: 0.085 * v, f: f2 * 0.9975, ratio: 2, idx: 1.2, a: 0.004 });
    fm(e, R, { t: t + 0.07, dur: 0.45, vol: 0.085 * v, f: f2 * 1.0025, ratio: 2, idx: 1.2, a: 0.004 });
    T(e, C, { t, dur: 0.22, vol: 0.09 * v, type: 'sine', f0: f1 / 2, a: 0.006 });
    T(e, C, { t: t + 0.07, dur: 0.3, vol: 0.05 * v, type: 'triangle', f0: f2 / 2, a: 0.006 });
    N(e, C, { t, dur: 0.14, vol: 0.02 * v, type: 'bandpass', f0: 2000, f1: 6500, q: 2.5, a: 0.03 });
    return 0.75;
  },

  // Shield cell: a short clean energy chime. Root, fifth and octave step up in quick succession; pitch follows e.p, which
  // audio.js raises by a whole tone per cell in a chain. Upper partials are trimmed as pitch rises so it never turns shrill.
  cell(e) {
    const p = e.p * rr(e, 0.99, 1.01), v = e.v, t = e.t;
    const soft = 1 / Math.pow(Math.max(1, p), 1.3);
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.075, 0.25, 3500 / Math.sqrt(p), 0.2, -0.2);
    const send = bus(e, slap, 0, 0.7);
    const L = bus(e, mix, -0.3, 1, send), R = bus(e, mix, 0.3, 1, send), C = bus(e, mix, 0, 1, send);
    const f = 622 * p;
    const note = (at, mult, dur, vol) => {
      const fr = f * mult;
      T(e, L, { t: at, dur, vol: vol * 0.5 * v, type: 'sine', f0: fr * 0.997, a: 0.004 });
      T(e, R, { t: at, dur, vol: vol * 0.5 * v, type: 'sine', f0: fr * 1.003, a: 0.004 });
      T(e, C, { t: at, dur: dur * 0.5, vol: vol * 0.28 * soft * v, type: 'sine', f0: fr * 2, a: 0.003 });
      T(e, C, { t: at, dur: 0.06, vol: vol * 0.16 * soft * v, type: 'sine', f0: fr * 2.76, a: 0.002 });
    };
    note(t, 1, 0.3, 0.3);
    note(t + 0.05, 1.5, 0.36, 0.28);
    note(t + 0.1, 2, 0.34, 0.2);
    T(e, C, { t, dur: 0.1, vol: 0.06 * v, type: 'sine', f0: f / 2, a: 0.004 });
    N(e, C, { t, dur: 0.1, vol: 0.03 * soft * v, type: 'bandpass', f0: 1800 * p, f1: 6500, q: 2, a: 0.015 });
    return 0.62;
  },

  // Capacitor: rare, valuable. A staggered warm add9 chord that swells through an opening filter, detuned pairs spread wide,
  // a slow sub swell, a shimmer of sparkles and a reverb tail.
  capacitor(e) {
    const p = e.p * rr(e, 0.995, 1.005), v = e.v, t = e.t;
    const mix = bus(e, e.out, 0);
    const send = reverb(e, mix, 1.3, 0.6);
    const lp = e.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(6500, t + 0.4);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 1.5);
    lp.connect(mix); lp.connect(send);
    const notes = [[196, 0, 0.13], [392, 0.03, 0.12], [587.3, 0.07, 0.11], [784, 0.11, 0.1], [987.8, 0.16, 0.085], [1174.7, 0.21, 0.07], [1568, 0.26, 0.045]];
    notes.forEach(([fq, off, vol], i) => {
      const at = t + off, dur = 1.35 - off * 0.6, a = 0.14 + off * 0.5;
      const pan = (i % 2 ? 1 : -1) * Math.min(0.7, 0.15 + i * 0.1);
      const A = bus(e, lp, pan), B = bus(e, lp, -pan);
      T(e, A, { t: at, dur, vol: vol * 0.55 * v, type: i < 2 ? 'sawtooth' : 'triangle', f0: fq * p, detune: 7, a, lp: i < 2 ? 900 : undefined });
      T(e, B, { t: at, dur, vol: vol * 0.55 * v, type: 'sine', f0: fq * p, detune: -7, a });
    });
    T(e, mix, { t, dur: 1.3, vol: 0.14 * v, type: 'sine', f0: 98 * p, f1: 98 * p * 1.005, a: 0.28, hp: 40 });
    N(e, lp, { t: t + 0.1, dur: 0.95, vol: 0.04 * v, type: 'bandpass', f0: 2800, f1: 9000, q: 3.5, a: 0.3 });
    const pent = [1568, 1976, 2349, 2637, 3136, 3951];
    for (let i = 0; i < 8; i++) {
      const at = t + 0.22 + Math.pow(e.r(), 1.1) * 0.95;
      const s = bus(e, mix, rr(e, -0.75, 0.75), 1, send);
      fm(e, s, { t: at, dur: rr(e, 0.22, 0.42), vol: 0.045 * v, f: pent[Math.floor(e.r() * pent.length)] * p, ratio: 3, idx: 0.5, a: 0.002 });
    }
    return 1.95;
  },

  // Danger klaxon, short version: two rounded, hollow pulses that step down a major third. Filtered, no glides, no siren.
  alarm(e) {
    const p = e.p * rr(e, 0.99, 1.01), v = e.v, t = e.t, ac = e.ac;
    const mix = bus(e, e.out, 0);
    const slap = echo(e, mix, 0.11, 0.32, 1600, 0.25);
    const gate = ac.createGain(); gate.gain.value = 0.0001;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(700, t);
    gate.connect(lp); lp.connect(mix); lp.connect(slap);
    const pulses = [[0, 330], [0.3, 262]];
    const nodes = [gate, lp];
    let first = null;
    for (const [ft, det, type, gv] of [[1, 6, 'square', 0.05], [1, -6, 'square', 0.05], [1.5, 0, 'sine', 0.05], [0.5, 0, 'sine', 0.06]]) {
      const o = ac.createOscillator(); o.type = type; o.detune.value = det;
      pulses.forEach(([off, fq]) => o.frequency.setValueAtTime(fq * ft * p, t + off));
      const g = ac.createGain(); g.gain.value = gv * v;
      o.connect(g); g.connect(gate);
      o.start(t); o.stop(t + 0.75);
      nodes.push(o, g);
      first = first || o;
    }
    pulses.forEach(([off]) => {
      const s = t + off;
      gate.gain.setValueAtTime(0.0001, s);
      gate.gain.linearRampToValueAtTime(1, s + 0.025);
      gate.gain.setValueAtTime(1, s + 0.15);
      gate.gain.exponentialRampToValueAtTime(0.0001, s + 0.27);
      lp.frequency.setValueAtTime(700, s);
      lp.frequency.exponentialRampToValueAtTime(1900, s + 0.06);
      lp.frequency.exponentialRampToValueAtTime(800, s + 0.27);
    });
    first.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (err) { /* gone */ } } };
    return 1.15;
  },

  // Boss and hazard warning: three slow low horn pulses (a filtered detuned saw stack on a fifth, with a sub) and a soft
  // beacon ping on each onset. Wide, dark and rounded so it stays tolerable on repeat.
  warning(e) {
    const p = e.p * rr(e, 0.99, 1.01), v = e.v, t = e.t, ac = e.ac;
    const mix = bus(e, e.out, 0);
    const send = reverb(e, mix, 1.1, 0.3);
    const gate = ac.createGain(); gate.gain.value = 0.0001;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(400, t);
    gate.connect(lp); lp.connect(mix); lp.connect(send);
    const period = 0.62, n = 3, nodes = [gate, lp];
    let first = null;
    const voices = [[146.8, 8, 'sawtooth', 0.055], [146.8, -8, 'sawtooth', 0.055], [220, 5, 'sawtooth', 0.04], [220, -5, 'sawtooth', 0.04], [73.4, 0, 'sine', 0.06]];
    for (const [fq, det, type, gv] of voices) {
      const o = ac.createOscillator(); o.type = type; o.detune.value = det;
      for (let i = 0; i < n; i++) {
        o.frequency.setValueAtTime(fq * p, t + i * period);
        o.frequency.exponentialRampToValueAtTime(fq * p * 0.94, t + i * period + 0.42);
      }
      const g = ac.createGain(); g.gain.value = gv * v;
      o.connect(g); g.connect(gate);
      o.start(t); o.stop(t + n * period + 0.2);
      nodes.push(o, g);
      first = first || o;
    }
    for (let i = 0; i < n; i++) {
      const s = t + i * period;
      gate.gain.setValueAtTime(0.0001, s);
      gate.gain.linearRampToValueAtTime(1, s + 0.05);
      gate.gain.setValueAtTime(1, s + 0.3);
      gate.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      lp.frequency.setValueAtTime(400, s);
      lp.frequency.exponentialRampToValueAtTime(1900 + i * 200, s + 0.11);
      lp.frequency.exponentialRampToValueAtTime(600, s + 0.5);
      T(e, mix, { t: s, dur: 0.16, vol: 0.03 * v, type: 'sine', f0: 880 * p, a: 0.004 });
      T(e, mix, { t: s, dur: 0.2, vol: 0.08 * v, type: 'sine', f0: 92 * p, f1: 50, sweep: 0.8, hp: 30, a: 0.004 });
    }
    first.onended = () => { for (const nd of nodes) { try { nd.disconnect(); } catch (err) { /* gone */ } } };
    return n * period + 0.55;
  },
};

// gap: min seconds between plays, max: concurrent voices, prio: higher wins, group: dedupe group, gain: per voice trim.
// Explosions share the 'boom' group (audio.js merges event driven booms within 60 ms) and keep low voice counts.
export const IMPACT_META = {
  enemyShot: { gap: 0.06, max: 4, prio: 1, gain: 1.3 },
  hit: { gap: 0.045, max: 4, prio: 1, group: 'hit', gain: 1.05 },
  bossHit: { gap: 0.09, max: 3, prio: 2, group: 'hit', gain: 1.0 },
  explosion: { gap: 0.07, max: 4, prio: 3, group: 'boom', gain: 0.8 },
  bigExplosion: { gap: 0.25, max: 3, prio: 5, group: 'boom', gain: 0.85 },
  damage: { gap: 0.12, max: 2, prio: 5, gain: 1.1 },
  pickup: { gap: 0.08, max: 3, prio: 3, gain: 1.7 },
  cell: { gap: 0.06, max: 4, prio: 3, gain: 0.6 },
  capacitor: { gap: 0.4, max: 1, prio: 4, gain: 1.15 },
  alarm: { gap: 0.5, max: 1, prio: 4, gain: 0.85 },
  warning: { gap: 0.5, max: 1, prio: 5, gain: 0.9 },
};
