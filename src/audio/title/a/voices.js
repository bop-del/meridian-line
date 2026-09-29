// Voices and effects for title variant A. Everything schedules at absolute time t on the given AudioContext and
// disconnects itself when it has finished. No Math.random: variation comes from a seeded PRNG passed in.
import { mtof, getNoise, tone } from '../../synth.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanup(src, nodes) {
  src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } } };
}

/** Procedural convolution reverb impulse: decorrelated stereo noise, exponential decay, darkening tail. */
export function makeImpulse(ac, seconds = 4.2, seed = 4242) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.028);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(seed + ch * 977);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const x = rnd() * 2 - 1;
      // one pole lowpass that closes over time (air absorption)
      const k = 0.05 + 0.55 * Math.exp(-t / 0.7);
      y += k * (x - y);
      const attack = i < pre ? 0 : Math.min(1, (i - pre) / (sr * 0.09));
      d[i] = y * attack * Math.exp((-6.91 * t) / seconds);
    }
  }
  return buf;
}

/** Wide detuned saw pad note through the shared pad filter. */
export function padNote(ac, dest, t, dur, midi, o) {
  const f = mtof(midi);
  const att = o.att ?? 2.0, rel = o.rel ?? 2.6;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + att);
  g.gain.setValueAtTime(o.vol, t + Math.max(att + 0.01, dur));
  g.gain.linearRampToValueAtTime(0, t + dur + rel);
  g.connect(dest);
  const nodes = [g];
  for (let k = 0; k < 2; k++) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = (k === 0 ? -1 : 1) * (o.cents + k * 1.5);
    const p = ac.createStereoPanner();
    p.pan.value = (k === 0 ? o.pan : -o.pan * 0.8);
    osc.connect(p); p.connect(g);
    osc.start(t); osc.stop(t + dur + rel + 0.05);
    nodes.push(osc, p);
    if (k === 1) cleanup(osc, nodes);
  }
}

/** Deep sine sub with a faint second harmonic so it survives small speakers. */
export function subNote(ac, dest, t, dur, midi, vol) {
  const f = mtof(midi);
  const g = ac.createGain();
  const att = 0.7, rel = 1.1;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, t + Math.max(att + 0.01, dur));
  g.gain.linearRampToValueAtTime(0, t + dur + rel);
  g.connect(dest);
  const nodes = [g];
  const a = ac.createOscillator(); a.type = 'sine'; a.frequency.value = f;
  const b = ac.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2;
  const bg = ac.createGain(); bg.gain.value = 0.22;
  a.connect(g); b.connect(bg); bg.connect(g);
  // start on a whole period of the absolute clock so every sub note shares one global phase: a same-pitch
  // crossfade then sums coherently (constant level) instead of beating or bumping
  const ts = Math.ceil(t * f) / f;
  a.start(ts); b.start(ts);
  a.stop(t + dur + rel + 0.05); b.stop(t + dur + rel + 0.05);
  nodes.push(a, b, bg);
  cleanup(b, nodes);
}

/** Distant horn: two low-passed saws, slow attack, vibrato only when the note is long. */
export function hornNote(ac, dest, t, dur, midi, vol, pan) {
  const f = mtof(midi);
  const att = 0.85, rel = 1.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol * 0.9, t + Math.max(att + 0.1, dur * 0.7));
  g.gain.linearRampToValueAtTime(vol * 0.85, t + Math.max(att + 0.2, dur));
  g.gain.linearRampToValueAtTime(0, t + dur + rel);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(Math.min(f * 1.3, 1200), t);
  lp.frequency.linearRampToValueAtTime(Math.min(f * 3.4, 1700), t + att + 0.5);
  lp.frequency.linearRampToValueAtTime(Math.min(f * 2.4, 1300), t + dur + rel);
  const p = ac.createStereoPanner(); p.pan.value = pan;
  lp.connect(g); g.connect(p); p.connect(dest);
  const nodes = [g, lp, p];
  const oscs = [];
  [[-5, 'sawtooth', 1], [5, 'sawtooth', 1], [0, 'triangle', 0.7]].forEach(([det, type, gain]) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
    if (gain !== 1) { const gg = ac.createGain(); gg.gain.value = gain; o.connect(gg); gg.connect(lp); nodes.push(gg); } else o.connect(lp);
    o.start(t); o.stop(t + dur + rel + 0.1);
    oscs.push(o); nodes.push(o);
  });
  if (dur >= 5 * 0.8333) { // long sustained notes only
    const lfo = ac.createOscillator(); lfo.frequency.value = 4.6;
    const amt = ac.createGain();
    amt.gain.setValueAtTime(0, t);
    amt.gain.setValueAtTime(0, t + 1.3);
    amt.gain.linearRampToValueAtTime(8, t + 2.8);
    lfo.connect(amt);
    for (const o of oscs) amt.connect(o.detune);
    lfo.start(t); lfo.stop(t + dur + rel + 0.1);
    nodes.push(lfo, amt);
  }
  cleanup(oscs[2], nodes);
}

/** FM electric-piano-ish pluck: 1:1 sine FM with decaying index plus a short inharmonic tine. */
export function fmPluck(ac, dest, t, midi, vel, pan) {
  const f = mtof(midi);
  const car = ac.createOscillator(); car.frequency.value = f;
  const mod = ac.createOscillator(); mod.frequency.value = f;
  const mg = ac.createGain();
  mg.gain.setValueAtTime(f * (0.9 + 1.5 * vel), t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.6);
  mod.connect(mg); mg.connect(car.frequency);
  const g = ac.createGain();
  const vol = 0.32 * vel;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
  const tine = ac.createOscillator(); tine.frequency.value = f * 7.02;
  const tg = ac.createGain();
  tg.gain.setValueAtTime(vol * 0.12, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  tine.connect(tg); tg.connect(g);
  const p = ac.createStereoPanner(); p.pan.value = pan;
  car.connect(g); g.connect(p); p.connect(dest);
  car.start(t); mod.start(t); tine.start(t);
  car.stop(t + 5.6); mod.stop(t + 5.6); tine.stop(t + 0.4);
  cleanup(car, [car, mod, mg, g, tine, tg, p]);
}

/** Heartbeat lub-dub on a low tom. */
export function heartbeat(ac, dest, t, vel) {
  tone(ac, dest, { type: 'sine', f0: 84, f1: 45, t, dur: 0.6, vol: 0.5 * vel, a: 0.006, sweep: 0.5, hold: 0.05 });
  tone(ac, dest, { type: 'sine', f0: 168, f1: 90, t, dur: 0.16, vol: 0.09 * vel, a: 0.004, sweep: 0.5 });
  const t2 = t + 0.34;
  tone(ac, dest, { type: 'sine', f0: 92, f1: 50, t: t2, dur: 0.55, vol: 0.32 * vel, a: 0.006, sweep: 0.5, hold: 0.05 });
}

/** Soft timpani tuned to D2, with a few inharmonic partials for body. */
export function timpani(ac, dest, t, vel) {
  const f = 73.42;
  tone(ac, dest, { type: 'sine', f0: f * 1.18, f1: f, t, dur: 3.6, vol: 0.3 * vel, a: 0.006, sweep: 0.06, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 1.5, f1: f * 1.48, t, dur: 1.9, vol: 0.12 * vel, a: 0.005, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 1.98, f1: f * 1.96, t, dur: 1.2, vol: 0.07 * vel, a: 0.004, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 2.44, f1: f * 2.4, t, dur: 0.8, vol: 0.04 * vel, a: 0.004, hold: 0.02 });
}

/**
 * Filtered noise gesture. shape 'swell': slow up, slow down. shape 'riser': exponential build, sudden end (reversed cymbal).
 * o: {type, f0, f1, q, vol, pan, shape, off}
 */
export function noiseBand(ac, dest, t, dur, o) {
  const nb = getNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = o.brown ? nb.brown : nb.white;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0, t);
  f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
  const g = ac.createGain();
  if (o.shape === 'riser') {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  } else {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.vol, t + dur * (o.peak ?? 0.5));
    g.gain.linearRampToValueAtTime(0, t + dur);
  }
  const p = ac.createStereoPanner(); p.pan.value = o.pan ?? 0;
  src.connect(f); f.connect(g); g.connect(p); p.connect(dest);
  src.start(t, (o.off ?? 0) * 1.5);
  src.stop(t + dur + 0.1);
  cleanup(src, [src, f, g, p]);
}

/** Output ceiling: linear up to 0.35, smooth knee toward a hard limit at 0.5. */
export function ceilingCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1, a = Math.abs(x);
    const y = a <= 0.35 ? a : 0.35 + 0.15 * Math.tanh((a - 0.35) / 0.15);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
