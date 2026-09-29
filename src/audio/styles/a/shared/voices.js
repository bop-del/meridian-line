// Extra voices for style A (Cinematic drift) beyond the title theme's set in ../../../title/a/voices.js. Same rules:
// everything schedules at absolute time t on the given AudioContext, disconnects itself when finished and uses no
// Math.random (variation comes from a seeded PRNG passed in).
import { mtof, getNoise, tone } from '../../../synth.js';

function cleanup(src, nodes) {
  src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } } };
}

/** Bowed low string: three detuned saws plus a sine an octave down through its own slowly opening lowpass. */
export function lowString(ac, dest, t, dur, midi, vol, o = {}) {
  const f = mtof(midi);
  const att = o.att ?? 1.4, rel = o.rel ?? 1.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, t + Math.max(att + 0.01, dur));
  g.gain.linearRampToValueAtTime(0, t + dur + rel);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = o.q ?? 0.8;
  const c0 = o.cut ?? Math.min(f * 3, 700);
  lp.frequency.setValueAtTime(c0 * 0.6, t);
  lp.frequency.linearRampToValueAtTime(c0, t + att + 0.8);
  lp.frequency.linearRampToValueAtTime(c0 * 0.75, t + dur + rel);
  const p = ac.createStereoPanner(); p.pan.value = o.pan ?? 0;
  lp.connect(g); g.connect(p); p.connect(dest);
  const nodes = [g, lp, p];
  const end = t + dur + rel + 0.05;
  const det = o.cents ?? 8;
  let last = null;
  [-det, 0, det].forEach((d, i) => {
    const os = ac.createOscillator(); os.type = 'sawtooth'; os.frequency.value = f; os.detune.value = d;
    const gg = ac.createGain(); gg.gain.value = i === 1 ? 0.7 : 0.55;
    os.connect(gg); gg.connect(lp); os.start(t); os.stop(end);
    nodes.push(os, gg); last = os;
  });
  const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
  const sg = ac.createGain(); sg.gain.value = 0.5;
  sub.connect(sg); sg.connect(g); sub.start(t); sub.stop(end);
  nodes.push(sub, sg);
  cleanup(sub, nodes);
  return last;
}

/** Short spiccato string note for ostinatos: two detuned saws, filter closing over the note. */
export function stringHit(ac, dest, t, dur, midi, vol, pan = 0, bright = 1) {
  const f = mtof(midi);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.014);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + Math.max(0.03, dur * 0.7));
  g.gain.linearRampToValueAtTime(0, t + dur + 0.07);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(Math.min(f * 7 * bright, 4600), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(180, Math.min(f * 2.4 * bright, 1800)), t + dur);
  const p = ac.createStereoPanner(); p.pan.value = pan;
  lp.connect(g); g.connect(p); p.connect(dest);
  const nodes = [g, lp, p];
  let last = null;
  [-7, 7].forEach((d) => {
    const os = ac.createOscillator(); os.type = 'sawtooth'; os.frequency.value = f; os.detune.value = d;
    os.connect(lp); os.start(t); os.stop(t + dur + 0.1);
    nodes.push(os); last = os;
  });
  cleanup(last, nodes);
}

/** Horn stab: same colour as the title horn but with a fast attack and no vibrato, for the boss theme. */
export function hornStab(ac, dest, t, dur, midi, vol, pan = 0) {
  const f = mtof(midi);
  const att = 0.07, rel = 0.7;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.linearRampToValueAtTime(vol * 0.7, t + Math.max(att + 0.05, dur * 0.6));
  g.gain.linearRampToValueAtTime(0, t + dur + rel);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.9;
  lp.frequency.setValueAtTime(Math.min(f * 2.2, 1500), t);
  lp.frequency.linearRampToValueAtTime(Math.min(f * 4.2, 2400), t + att + 0.25);
  lp.frequency.linearRampToValueAtTime(Math.min(f * 2.4, 1400), t + dur + rel);
  const p = ac.createStereoPanner(); p.pan.value = pan;
  lp.connect(g); g.connect(p); p.connect(dest);
  const nodes = [g, lp, p];
  let last = null;
  [[-5, 'sawtooth', 1], [5, 'sawtooth', 1], [0, 'triangle', 0.7]].forEach(([det, type, gain]) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
    if (gain !== 1) { const gg = ac.createGain(); gg.gain.value = gain; o.connect(gg); gg.connect(lp); nodes.push(gg); } else o.connect(lp);
    o.start(t); o.stop(t + dur + rel + 0.1);
    nodes.push(o); last = o;
  });
  cleanup(last, nodes);
}

/** Soft timpani at any pitch. len scales the ring time. */
export function timpaniAt(ac, dest, t, vel, f = 73.42, len = 1) {
  tone(ac, dest, { type: 'sine', f0: f * 1.18, f1: f, t, dur: 3.2 * len, vol: 0.3 * vel, a: 0.006, sweep: 0.06, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 1.5, f1: f * 1.48, t, dur: 1.7 * len, vol: 0.12 * vel, a: 0.005, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 1.98, f1: f * 1.96, t, dur: 1.1 * len, vol: 0.07 * vel, a: 0.004, hold: 0.02 });
  tone(ac, dest, { type: 'sine', f0: f * 2.44, f1: f * 2.4, t, dur: 0.7 * len, vol: 0.04 * vel, a: 0.004, hold: 0.02 });
}

/** Low tom: sine drop plus a dull noise thump. */
export function tomHit(ac, dest, t, vel, f = 70, len = 1) {
  tone(ac, dest, { type: 'sine', f0: f * 1.7, f1: f, t, dur: 0.7 * len, vol: 0.42 * vel, a: 0.004, sweep: 0.12, hold: 0.05 });
  tone(ac, dest, { type: 'sine', f0: f * 3.1, f1: f * 2.0, t, dur: 0.14 * len, vol: 0.07 * vel, a: 0.003, sweep: 0.5 });
  noiseTick(ac, dest, t, 0.05, { type: 'lowpass', f: 650, q: 0.7, vol: 0.22 * vel, off: f / 100 });
}

/** Short filtered noise tick with an exponential decay (embers, drum clicks, metal scrapes). */
export function noiseTick(ac, dest, t, dur, o) {
  const nb = getNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = o.brown ? nb.brown : nb.white;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = o.type || 'bandpass'; f.frequency.value = o.f; f.Q.value = o.q ?? 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t + Math.min(0.004, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ac.createStereoPanner(); p.pan.value = o.pan ?? 0;
  src.connect(f); f.connect(g); g.connect(p); p.connect(dest);
  src.start(t, ((o.off ?? 0) % 1) * 1.5);
  src.stop(t + dur + 0.05);
  cleanup(src, [src, f, g, p]);
}

/** Distant metal strike: inharmonic partials with staggered decays plus a dull noise body. */
export function clank(ac, dest, t, vel, f = 180, pan = 0) {
  const parts = [[1, 1, 2.2], [2.76, 0.55, 1.4], [5.4, 0.32, 0.8], [8.93, 0.16, 0.45]];
  const out = ac.createGain();
  const p = ac.createStereoPanner(); p.pan.value = pan;
  out.connect(p); p.connect(dest);
  const nodes = [out, p];
  let last = null;
  for (const [r, a, d] of parts) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11 * vel * a, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    nodes.push(o, g); last = o;
  }
  cleanup(last, nodes);
  noiseTick(ac, dest, t, 0.09, { type: 'bandpass', f: f * 3.2, q: 1.4, vol: 0.09 * vel, pan, off: f / 37 });
}

/** Slow sine glide (a groan) with a faint filtered saw for grit. */
export function glideSub(ac, dest, t, dur, m0, m1, vol) {
  const f0 = mtof(m0), f1 = mtof(m1);
  const att = Math.min(1.4, dur * 0.4), rel = Math.min(1.6, dur * 0.4);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.setValueAtTime(vol, t + Math.max(att + 0.01, dur - rel));
  g.gain.linearRampToValueAtTime(0, t + dur);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.8;
  const a = ac.createOscillator(); a.type = 'sine';
  a.frequency.setValueAtTime(f0, t); a.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const b = ac.createOscillator(); b.type = 'sawtooth'; b.detune.value = 6;
  b.frequency.setValueAtTime(f0 * 2, t); b.frequency.exponentialRampToValueAtTime(f1 * 2, t + dur);
  const bg = ac.createGain(); bg.gain.value = 0.16;
  a.connect(g); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(dest);
  a.start(t); b.start(t); a.stop(t + dur + 0.05); b.stop(t + dur + 0.05);
  cleanup(b, [a, b, bg, lp, g]);
}

/** Short low sine pulse for driving eighth-note bass (fast attack, quick decay). */
export function subPulse(ac, dest, t, dur, midi, vol) {
  const f = mtof(midi);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  const a = ac.createOscillator(); a.type = 'sine'; a.frequency.value = f;
  const b = ac.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2;
  const bg = ac.createGain(); bg.gain.value = 0.25;
  a.connect(g); b.connect(bg); bg.connect(g); g.connect(dest);
  a.start(t); b.start(t); a.stop(t + dur + 0.1); b.stop(t + dur + 0.1);
  cleanup(b, [a, b, bg, g]);
}

/** Soft glass bell: sine partials at bell-like ratios with staggered decays. */
export function bell(ac, dest, t, midi, vel, pan = 0, ring = 5) {
  const f = mtof(midi);
  const out = ac.createGain();
  const p = ac.createStereoPanner(); p.pan.value = pan;
  out.connect(p); p.connect(dest);
  const nodes = [out, p];
  let last = null;
  for (const [r, a, d] of [[1, 1, ring], [2.0, 0.28, ring * 0.5], [2.76, 0.2, ring * 0.3], [5.4, 0.07, ring * 0.12]]) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vel * a, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    nodes.push(o, g); last = o;
  }
  cleanup(last, nodes);
}
