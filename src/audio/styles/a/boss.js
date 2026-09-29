// Style A, boss theme: G phrygian, 108 BPM, 32 bars (about 71 s), always at full intensity. Urgent cinematic drive with a
// restrained rhythmic layer the calm tracks lack: spiccato string ostinato (3+3+2 accents), driving timpani and low toms,
// eighth-note sub pulses, horn stabs and a leaping horn theme. Form: 0-7 A (ostinato and timpani), 8-15 B (the theme),
// 16-23 A' (octave-doubled strings), 24-31 tension (dissonant pedal, sixteenth-note ostinato, timpani on every eighth,
// rising risers) that drops straight back into bar 0. One theme serves all three bosses.
import { defineTrack } from './shared/engine.js';
import { arc, arpGen, chordAtFn } from './shared/gen.js';
import { stringHit, hornStab, timpaniAt, tomHit, subPulse } from './shared/voices.js';
import { mulberry32 } from '../../title/a/voices.js';

const BPM = 108, BARS = 32;

const intensity = arc([[0, 0.8], [7, 0.86], [8, 0.9], [15, 0.95], [16, 0.96], [23, 1], [24, 1], [31, 1]], BARS);

const pads = [
  [0, 4, [43, 50, 55, 58, 62]],          // Gm
  [4, 2, [43, 56, 60, 63]],              // Ab over G
  [6, 2, [43, 50, 58, 62]],              // Gm
  [8, 2, [39, 46, 55, 58, 63]],          // Eb
  [10, 2, [41, 48, 55, 60]],             // Fsus2
  [12, 2, [44, 51, 56, 60, 63]],         // Ab
  [14, 2, [43, 50, 58, 62]],             // Gm
  [16, 4, [43, 50, 55, 58, 62]],
  [20, 2, [43, 56, 60, 63]],
  [22, 2, [43, 50, 58, 62]],
  [24, 2, [43, 49, 55, 58, 61]],         // G Db: the tritone enters
  [26, 2, [43, 50, 56, 63]],             // G D Ab Eb
  [28, 2, [43, 49, 55, 61]],             // G Db stacked
  [30, 2, [43, 50, 55, 58]],
];
const bass = [[0, 4, 31], [4, 2, 32], [6, 2, 31], [8, 2, 27], [10, 2, 29], [12, 2, 32], [14, 2, 31], [16, 4, 31], [20, 2, 32], [22, 2, 31], [24, 8, 31]];

// Ostinato root per bar and chord kind: m = minor, M = major, s = sus2
const ROOT = [43, 43, 43, 43, 44, 44, 43, 43, 39, 39, 41, 41, 44, 44, 43, 43, 43, 43, 43, 43, 44, 44, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43];
const KIND = 'mmmmMMmmMMssMMmmmmmmMMmmmmmmmmmm';
const CELL = {
  m: [0, 7, 12, 10, 7, 12, 13, 7],
  M: [0, 7, 12, 14, 7, 12, 16, 7],
  s: [0, 7, 12, 14, 7, 12, 14, 7],
  end: [0, 7, 12, 15, 12, 7, 3, 7],
  d16: [0, 0, 7, 0, 13, 0, 7, 0, 12, 0, 7, 0, 10, 0, 7, 0],
};

// Horn: [bar, beat, midi, beats]. Theme in bars 8-15 and again 16-23 over the strings, tension pedal at the end.
const theme = [
  [0, 0, 70, 2.5], [0, 3, 63, 1], [1, 0, 72, 3],
  [2, 0, 65, 2], [2, 3, 72, 1], [3, 0, 68, 4],
  [4, 0, 75, 3], [4, 3, 68, 1], [5, 0, 72, 3],
  [6, 0, 70, 2], [6, 3, 62, 1], [7, 0, 67, 4],
];
const horn = [
  ...theme.map(([b, ...r]) => [8 + b, ...r]),
  ...theme.map(([b, ...r]) => [16 + b, ...r]),
  [24, 0, 74, 3], [25, 0, 73, 3], [26, 0, 74, 3], [27, 0, 79, 2], [28, 0, 72, 2], [28, 3, 79, 1], [29, 0, 80, 3], [30, 0, 74, 4],
];
// Stabs on the root (power fifth), bars 4-7 and 20-23 and pressure at the end: [bar, beat, midi, beats]
const stabs = [];
for (const b of [4, 5, 6, 7, 20, 21, 22, 23]) stabs.push([b, 0, 55, 1.2], [b, 1.5, 55, 0.8]);
for (let b = 24; b < 32; b++) stabs.push([b, 0, 55, 1], [b, 1.5, 58, 0.7], [b, 3, 61, 0.7]);

const chordAt = chordAtFn(pads);
const rng = mulberry32(2221);
const grid = [0.5, 1.5, 2.5, 3.5];
const plucks = [
  ...arpGen({ rng, from: 8, to: 16, poolAt: (b) => [...chordAt(b), 74], count: () => 2, grid, lo: 72, hi: 90, vel: [0.4, 0.55], tiers: [0] }),
  ...arpGen({ rng, from: 24, to: 32, poolAt: (b) => [...chordAt(b), 73, 79], count: () => 3, grid, lo: 72, hi: 92, vel: [0.4, 0.58], tiers: [0] }),
];

const timp = [];
const risers = [[6, 2, 0.5], [14, 2, 0.5], [21, 3, 0.7], [26, 2, 0.7], [29, 3, 0.9]];
const swells = [[22, 0, 8, 31], [30, 0, 8, 31]];
const air = [[10, 3, -0.6, 1200, 3800, 0.5], [18, 3, 0.6, 3600, 1200, 0.5], [25, 3, -0.6, 1400, 4200, 0.6], [29, 3, 0.6, 1800, 5200, 0.5]];

// Timpani / tom patterns per section: [beat, velocity]
const TIMP_A = [[0, 1], [1.5, 0.5], [2, 0.8], [3, 0.55]];
const TIMP_B = [[0, 1], [1, 0.5], [2, 0.85], [2.5, 0.45], [3, 0.6]];
const TIMP_A2 = [[0, 1], [1, 0.55], [1.5, 0.4], [2, 0.85], [3, 0.6], [3.5, 0.4]];
const TIMP_T = [[0, 1], [0.5, 0.35], [1, 0.6], [1.5, 0.35], [2, 0.9], [2.5, 0.35], [3, 0.65], [3.5, 0.4]];
const FILL = [[3, 0.6], [3.25, 0.5], [3.5, 0.7], [3.75, 0.85]];
const TOM_B = [[0.5, 0.45], [3.5, 0.5]];
const TOM_A2 = [[0.5, 0.4], [2.5, 0.5]];

const track = defineTrack({
  meta: {
    id: 'boss', name: 'Boss (Cinematic drift)', bpm: BPM, bars: BARS,
    description: 'G phrygian urgent drive: spiccato string ostinato, driving timpani and toms, sub pulses, horn stabs and a leaping horn theme, tension section into the loop.',
  },
  score: { intensity, pads, bass, horn: [], plucks, swells, risers, air, timp },
  adaptive: false,
  pad: { cut: [520, 3000], cents: 8, vol: 1.0 },
  delay: { l: 0.75, r: 1.5, fb: 0.5, lp: 3000 },
  reverb: { seed: 8484, seconds: 3.6 },
  drumLp: 900,
  mix: { trim: 0.37, subVol: 0.16, pluckVol: 0.9, riserVol: 0.4 },
  seed: 83,
  hook(api) {
    const { ac, BEAT } = api;
    const strBus = api.bus(0.9, 0.3, 0.08, null);
    const drums = api.bus(0.85, 0.35, 0, (n) => { const l = api.filt('lowpass', 900, 0.6); n.connect(l); return l; });
    const hornBus = api.bus(0.5, 0.9, 0.18, null);
    const subBus = api.bus(1, 0, 0, null);
    const STAB = new Map(), HORN = new Map();
    for (const e of stabs) { if (!STAB.has(e[0])) STAB.set(e[0], []); STAB.get(e[0]).push(e); }
    for (const e of horn) { if (!HORN.has(e[0])) HORN.set(e[0], []); HORN.get(e[0]).push(e); }
    return {
      bar(c) {
        const { t0, bar, rng: r, I, jit, vary } = c;
        const root = ROOT[bar], kind = KIND[bar];
        const sec = bar < 8 ? 0 : bar < 16 ? 1 : bar < 24 ? 2 : 3;
        const acc = [1, 0.62, 0.62, 0.95, 0.62, 0.62, 0.95, 0.62];
        // string ostinato
        const phraseEnd = bar % 4 === 3 && sec < 3;
        if (sec === 3 && bar >= 28) {
          const cell = CELL.d16;
          for (let i = 0; i < 16; i++) {
            const m = root + cell[i];
            const v = (i % 4 === 0 ? 1 : cell[i] === 0 ? 0.55 : 0.75) * (0.85 + 0.15 * ((bar - 28) / 3));
            stringHit(ac, strBus, t0 + i * BEAT * 0.25 + jit() * 0.5, BEAT * 0.22, m, 0.075 * v * vary(), (i % 2 ? 0.25 : -0.25), 1.25);
          }
          for (let i = 0; i < 16; i += 4) stringHit(ac, strBus, t0 + i * BEAT * 0.25, BEAT * 0.9, root + 24, 0.03 * (0.8 + 0.2 * r()), 0.4, 1.4);
        } else {
          const cell = phraseEnd ? CELL.end : CELL[kind];
          const bright = sec === 0 ? 1.0 : sec === 1 ? 1.15 : sec === 2 ? 1.3 : 1.4;
          for (let i = 0; i < 8; i++) {
            const m = root + cell[i];
            const v = acc[i] * (0.8 + 0.2 * I);
            stringHit(ac, strBus, t0 + i * BEAT * 0.5 + jit() * 0.5, BEAT * 0.44, m, 0.085 * v * vary(), (i % 2 ? 0.22 : -0.22), bright);
            if (sec >= 2) stringHit(ac, strBus, t0 + i * BEAT * 0.5 + jit() * 0.5, BEAT * 0.4, m + 12, 0.04 * v * vary(), (i % 2 ? -0.35 : 0.35), bright);
          }
        }
        // sub pulses on the accent grid (3+3+2), every eighth in the tension section
        const pulseAt = sec === 3 ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : [0, 1.5, 3];
        for (const b of pulseAt) subPulse(ac, subBus, t0 + b * BEAT, BEAT * 0.42, root - 12, 0.13 * (0.75 + 0.25 * I));
        // timpani and toms
        const tp = sec === 0 ? TIMP_A : sec === 1 ? TIMP_B : sec === 2 ? TIMP_A2 : TIMP_T;
        const fill = bar % 8 === 7;
        const f = 440 * Math.pow(2, (root - 69) / 12);
        for (const [beat, vel] of tp) {
          if (fill && beat >= 3) continue;
          timpaniAt(ac, drums, t0 + beat * BEAT + jit(), vel * (0.7 + 0.3 * I) * vary(), f, 0.5);
        }
        if (fill) for (const [beat, vel] of FILL) timpaniAt(ac, drums, t0 + beat * BEAT, vel, f, 0.45);
        const tm = sec === 1 ? TOM_B : sec === 2 ? TOM_A2 : sec === 3 ? TOM_A2 : bar >= 4 ? [[3.5, 0.4]] : [];
        for (const [beat, vel] of tm) tomHit(ac, drums, t0 + beat * BEAT + jit(), vel * vary(), 66, 0.7);
        if (sec === 3 && bar >= 28) for (let i = 0; i < 4; i++) tomHit(ac, drums, t0 + (2 + i * 0.5) * BEAT, 0.3 + 0.05 * (bar - 28), 60, 0.5);
        // horn: theme and stabs
        for (const [, beat, midi, beats] of HORN.get(bar) || []) {
          hornStab(ac, hornBus, t0 + beat * BEAT + jit() * 3, beats * BEAT, midi, 0.14 * (0.8 + 0.2 * I) * vary(), midi % 2 ? 0.25 : -0.25);
        }
        for (const [, beat, midi, beats] of STAB.get(bar) || []) {
          hornStab(ac, hornBus, t0 + beat * BEAT + jit(), beats * BEAT, midi, 0.1 * vary(), 0);
        }
      },
    };
  },
});

export const meta = track.meta;
export const create = track.create;
