// Procedural sound effects. Each definition receives an env {ac, out, t, v, p, r} and returns its duration in seconds.
//   ac: AudioContext, out: node to connect to, t: start time, v: volume multiplier, p: pitch multiplier, r: random() function
import { tone, noise } from './synth.js';

const N = (e, o) => noise(e.ac, e.out, o);
const T = (e, o) => tone(e.ac, e.out, o);

function boom(e, t, s = 1, v = 1) {
  N(e, { t, dur: 0.85 * s, vol: 0.5 * v * e.v, type: 'lowpass', f0: 4200, f1: 180, q: 0.9 });
  N(e, { t, dur: 1.0 * s, vol: 0.4 * v * e.v, type: 'lowpass', f0: 900, f1: 55, buf: 'brown' });
  T(e, { t, dur: 0.55 * s, vol: 0.5 * v * e.v, type: 'sine', f0: 130 * e.p, f1: 30, sweep: 0.9 });
  for (let i = 0; i < 3; i++) N(e, { t: t + 0.05 + e.r() * 0.35 * s, dur: 0.05, vol: 0.14 * v * e.v, type: 'highpass', f0: 3500 + e.r() * 3000, q: 0.5 });
}

export const SFX = {
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
  explosion(e) {
    boom(e, e.t, 1, 1);
    return 1.1;
  },
  bigExplosion(e) {
    boom(e, e.t, 1.2, 1);
    boom(e, e.t + 0.32, 1.6, 0.8);
    N(e, { t: e.t, dur: 2.4, vol: 0.5 * e.v, type: 'lowpass', f0: 2400, f1: 45, buf: 'brown' });
    T(e, { t: e.t, dur: 2.0, vol: 0.5 * e.v, type: 'sine', f0: 82 * e.p, f1: 20, sweep: 0.95 });
    N(e, { t: e.t + 0.6, dur: 1.6, vol: 0.12 * e.v, type: 'bandpass', f0: 700, f1: 90, q: 0.6 });
    return 2.6;
  },
  hit(e) {
    const p = e.p * (0.95 + e.r() * 0.1);
    T(e, { t: e.t, dur: 0.06, vol: 0.24 * e.v, type: 'square', f0: 950 * p, f1: 320 * p, lp: 5000 });
    N(e, { t: e.t, dur: 0.05, vol: 0.22 * e.v, type: 'highpass', f0: 2800 });
    return 0.1;
  },
  damage(e) {
    N(e, { t: e.t, dur: 0.32, vol: 0.4 * e.v, type: 'bandpass', f0: 1100, f1: 180, q: 2 });
    T(e, { t: e.t, dur: 0.38, vol: 0.28 * e.v, type: 'sawtooth', f0: 230 * e.p, f1: 52, shape: 40, lp: 2500 });
    T(e, { t: e.t, dur: 0.3, vol: 0.45 * e.v, type: 'sine', f0: 80, f1: 32 });
    T(e, { t: e.t + 0.02, dur: 0.14, vol: 0.12 * e.v, type: 'square', f0: 620, f1: 140, shape: 20 });
    N(e, { t: e.t, dur: 0.06, vol: 0.2 * e.v, type: 'highpass', f0: 3000 });
    return 0.45;
  },
  alarm(e) {
    for (let i = 0; i < 4; i++) T(e, { t: e.t + i * 0.13, dur: 0.1, vol: 0.13 * e.v, a: 0.005, type: 'square', f0: (i % 2 ? 740 : 988) * e.p, lp: 2800 });
    return 0.6;
  },
  pickup(e) {
    [784, 1047, 1568].forEach((f, i) => {
      T(e, { t: e.t + i * 0.06, dur: 0.14, vol: 0.15 * e.v, type: 'triangle', f0: f * e.p });
      T(e, { t: e.t + i * 0.06, dur: 0.1, vol: 0.05 * e.v, type: 'sine', f0: f * 2 * e.p });
    });
    return 0.4;
  },
  cell(e) {
    [1047, 1319, 1568, 2093].forEach((f, i) => {
      T(e, { t: e.t + i * 0.05, dur: 0.7, vol: 0.11 * e.v, type: 'sine', f0: f * e.p });
      T(e, { t: e.t + i * 0.05, dur: 0.3, vol: 0.05 * e.v, type: 'triangle', f0: f * 2 * e.p });
    });
    return 1.0;
  },
  boost(e) {
    N(e, { t: e.t, dur: 0.7, vol: 0.32 * e.v, a: 0.15, type: 'bandpass', f0: 280, f1: 2600, q: 1.1 });
    T(e, { t: e.t, dur: 0.8, vol: 0.13 * e.v, a: 0.2, type: 'sawtooth', f0: 70 * e.p, f1: 250 * e.p, lp: 900 });
    T(e, { t: e.t, dur: 0.5, vol: 0.18 * e.v, type: 'sine', f0: 90, f1: 45 });
    return 0.9;
  },
  brake(e) {
    N(e, { t: e.t, dur: 0.5, vol: 0.24 * e.v, type: 'bandpass', f0: 2400, f1: 320, q: 1 });
    T(e, { t: e.t, dur: 0.45, vol: 0.16 * e.v, type: 'sine', f0: 180 * e.p, f1: 75 });
    return 0.6;
  },
  roll(e) {
    N(e, { t: e.t, dur: 0.38, vol: 0.32 * e.v, a: 0.05, type: 'bandpass', f0: 900, fmid: 3200, tmid: 0.45, f1: 700, q: 1.2 });
    T(e, { t: e.t, dur: 0.3, vol: 0.06 * e.v, type: 'triangle', f0: 400 * e.p, f1: 900 * e.p, sweep: 0.5 });
    return 0.45;
  },
  comm(e) {
    T(e, { t: e.t, dur: 0.04, vol: 0.09 * e.v, type: 'square', f0: 1800 * e.p, lp: 4500 });
    T(e, { t: e.t + 0.05, dur: 0.06, vol: 0.08 * e.v, type: 'square', f0: 1200 * e.p, lp: 4500 });
    N(e, { t: e.t, dur: 0.07, vol: 0.06 * e.v, type: 'highpass', f0: 5000 });
    N(e, { t: e.t + 0.07, dur: 0.14, vol: 0.05 * e.v, type: 'bandpass', f0: 2600, q: 1.5 });
    return 0.26;
  },
  uiMove(e) {
    T(e, { t: e.t, dur: 0.06, vol: 0.3 * e.v, type: 'triangle', f0: 880 * e.p, f1: 1100 * e.p });
    return 0.1;
  },
  uiSelect(e) {
    T(e, { t: e.t, dur: 0.08, vol: 0.14 * e.v, type: 'square', f0: 660 * e.p, lp: 3500 });
    T(e, { t: e.t + 0.06, dur: 0.16, vol: 0.15 * e.v, type: 'square', f0: 990 * e.p, lp: 3500 });
    T(e, { t: e.t + 0.06, dur: 0.2, vol: 0.06 * e.v, type: 'sine', f0: 1980 * e.p });
    return 0.3;
  },
  warning(e) {
    const ac = e.ac;
    const osc = ac.createOscillator(); osc.type = 'sawtooth';
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = ac.createGain();
    const t = e.t;
    osc.frequency.setValueAtTime(480 * e.p, t);
    for (let i = 0; i < 3; i++) {
      osc.frequency.linearRampToValueAtTime(900 * e.p, t + i * 0.56 + 0.28);
      osc.frequency.linearRampToValueAtTime(480 * e.p, t + i * 0.56 + 0.56);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * e.v, t + 0.03);
    g.gain.setValueAtTime(0.16 * e.v, t + 1.6);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.75);
    osc.connect(lp); lp.connect(g); g.connect(e.out);
    osc.start(t); osc.stop(t + 1.8);
    osc.onended = () => { try { osc.disconnect(); lp.disconnect(); g.disconnect(); } catch (err) { /* ignore */ } };
    return 1.85;
  },
  bossHit(e) {
    [[180, 0.35, 0.2], [430, 0.28, 0.13], [780, 0.2, 0.09], [1270, 0.15, 0.06]].forEach(([f, d, v]) => T(e, { t: e.t, dur: d, vol: v * e.v, type: 'sine', f0: f * e.p }));
    N(e, { t: e.t, dur: 0.07, vol: 0.2 * e.v, type: 'highpass', f0: 2500 });
    T(e, { t: e.t, dur: 0.22, vol: 0.28 * e.v, type: 'sine', f0: 95, f1: 45 });
    return 0.5;
  },
  enemyShot(e) {
    const p = e.p * (0.95 + e.r() * 0.1);
    T(e, { t: e.t, dur: 0.17, vol: 0.17 * e.v, type: 'square', f0: 780 * p, f1: 210 * p, sweep: 0.85, lp: 3200 });
    T(e, { t: e.t, dur: 0.14, vol: 0.12 * e.v, type: 'triangle', f0: 420 * p, f1: 140 * p });
    return 0.2;
  },
  whoosh(e) {
    N(e, { t: e.t, dur: 0.65, vol: 0.28 * e.v, a: 0.12, type: 'bandpass', f0: 330, fmid: 1700, tmid: 0.45, f1: 280, q: 0.8 });
    return 0.7;
  },
};
SFX.ring = SFX.cell; // alias for older callers

// name -> {gap: min seconds between plays, max: concurrent voices, prio: higher survives voice stealing, group: dedupe group}
export const SFX_META = {
  laser: { gap: 0.04, max: 6, prio: 1, gain: 0.75 },
  laserCharge: { gap: 0.2, max: 1, prio: 2 },
  lockon: { gap: 0.05, max: 6, prio: 2 },
  chargedShot: { gap: 0.1, max: 3, prio: 3, gain: 0.8 },
  bomb: { gap: 0.3, max: 2, prio: 5, gain: 0.8 },
  explosion: { gap: 0.045, max: 7, prio: 3, group: 'boom', gain: 0.85 },
  bigExplosion: { gap: 0.1, max: 3, prio: 5, group: 'boom', gain: 0.7 },
  hit: { gap: 0.04, max: 5, prio: 1, group: 'hit' },
  bossHit: { gap: 0.06, max: 3, prio: 2, group: 'hit', gain: 0.8 },
  damage: { gap: 0.1, max: 3, prio: 5 },
  alarm: { gap: 0.4, max: 1, prio: 4 },
  pickup: { gap: 0.06, max: 3, prio: 3 },
  cell: { gap: 0.06, max: 4, prio: 3 },
  ring: { gap: 0.06, max: 4, prio: 3 }, // alias of cell, kept for older callers
  boost: { gap: 0.3, max: 1, prio: 3 },
  brake: { gap: 0.3, max: 1, prio: 3 },
  roll: { gap: 0.15, max: 2, prio: 2 },
  comm: { gap: 0.1, max: 2, prio: 4 },
  uiMove: { gap: 0.03, max: 3, prio: 4 },
  uiSelect: { gap: 0.06, max: 2, prio: 4 },
  warning: { gap: 0.4, max: 1, prio: 5 },
  enemyShot: { gap: 0.05, max: 5, prio: 1 },
  whoosh: { gap: 0.15, max: 2, prio: 2 },
};
