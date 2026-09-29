// Style A, level theme "cinder": B phrygian (the flat second C against B is the unease; F natural creeps in as the
// tritone late in the loop), 68 BPM, 32 bars (about 113 s). Sparse drifting debris: thin low pads, a slow sine sub with
// groans, ember ticks, lone plucks in long delay tails, a rare horn on dissonant leaps (minor ninth, tritone), and
// pressure that builds from bar 20 (low string cluster, timpani swells, heartbeat every bar).
// Layers arrive with level progress: 0 pad, sub, air, embers; 0.25 plucks; 0.4 horn; 0.55 heart, groans and cluster;
// 0.7 timpani and swells.
import { defineTrack } from './shared/engine.js';
import { arc, arpGen, chordAtFn } from './shared/gen.js';
import { lowString, glideSub, noiseTick } from './shared/voices.js';
import { mulberry32 } from '../../title/a/voices.js';

const BPM = 68, BARS = 32;

const intensity = arc([[0, 0.1], [3, 0.16], [4, 0.2], [11, 0.32], [12, 0.3], [19, 0.5], [20, 0.62], [23, 0.8], [26, 1], [27, 0.96], [28, 0.4], [31, 0.12]], BARS);

const pads = [
  [0, 4, [47, 54, 60, 64]],              // B F# C E: root, fifth, flat nine, fourth
  [4, 4, [47, 54, 62, 66]],              // Bm
  [8, 4, [47, 55, 62, 66]],              // Gmaj7/B
  [12, 4, [47, 60, 64, 67]],             // Cmaj7/B: the flat second as a chord
  [16, 4, [47, 52, 59, 62, 66]],         // Em(add9)-ish sus over B
  [20, 4, [47, 53, 62, 65]],             // B diminished: F natural, the tritone
  [24, 4, [47, 53, 60, 62]],             // B locrian cluster: F C D
  [28, 4, [47, 54, 60]],                 // back to the bare fifth with the flat nine
];

const bass = [[0, 8, 35], [8, 4, 35], [12, 4, 36], [16, 4, 35], [20, 4, 35], [24, 4, 35], [28, 4, 35]];

// Horn: [bar, beat, midi, beats]. Dissonant leaps, long rests.
const horn = [
  [6, 2, 66, 5],     // F#4
  [8, 0, 72, 4],     // C5
  [10, 1, 59, 6],    // down a minor ninth to B3
  [14, 0, 67, 5],    // G4
  [16, 2, 60, 6],    // C4
  [20, 0, 66, 8],    // F#4 over the diminished chord
  [22, 2, 72, 6],    // up a tritone to C5
  [24, 0, 62, 8],    // D4
  [26, 2, 71, 6],    // up a major sixth to B4
  [30, 0, 66, 8],    // F#4, thin echo
];

// Plucks: rare, high, leaping, into a long delay tail. Pool = chord tones plus the mode's sharp edges.
const chordAt = chordAtFn(pads);
const poolAt = (b) => [...chordAt(b), 71, 72, 74, 78];
const grid = [0, 0.75, 1.5, 2, 2.75, 3.5];
const rng = mulberry32(9313);
const plucks = [
  ...arpGen({ rng, from: 4, to: 12, poolAt, count: (b) => (b % 2 ? 1 : 0), grid, lo: 66, hi: 90, vel: [0.3, 0.44], tiers: [0.25] }),
  ...arpGen({ rng, from: 12, to: 20, poolAt, count: (b) => (b % 2 ? 2 : 1), grid, lo: 66, hi: 90, vel: [0.3, 0.46], tiers: [0.25, 0.5] }),
  ...arpGen({ rng, from: 20, to: 28, poolAt, count: () => 2, grid, lo: 66, hi: 92, vel: [0.32, 0.5], tiers: [0.3, 0.6] }),
  ...arpGen({ rng, from: 28, to: 32, poolAt, count: (b) => (b === 29 ? 1 : 0), grid, lo: 66, hi: 88, vel: [0.26, 0.34], tiers: [0.25] }),
];

const heart = [
  [8, 0.45, 0.55], [11, 0.45, 0.55], [14, 0.5, 0.55], [16, 0.5, 0.55], [18, 0.55, 0.55],
  [20, 0.6, 0.55], [21, 0.62, 0.55], [22, 0.66, 0.55], [23, 0.7, 0.55], [24, 0.74, 0.55], [25, 0.78, 0.55], [26, 0.82, 0.55], [27, 0.8, 0.55],
];
const timp = [[12, 0, 0.35, 0.7, 42], [20, 0, 0.7, 0.7, 42], [24, 0, 0.8, 0.7, 42], [28, 0, 0.3, 0.7, 42]];
const swells = [[19, 0, 8, 35], [23, 0, 8, 35]];
const risers = [[7, 1, 0.35, 0.4], [15, 1, 0.4, 0.4], [26, 2, 0.75, 0.55], [31, 1, 0.25]];
const air = [
  [1, 3, -0.6, 400, 1000, 0.5], [5, 3, 0.6, 1100, 420, 0.5], [9, 3, -0.5, 500, 1500, 0.55], [13, 3, 0.5, 1500, 600, 0.6],
  [17, 3, -0.6, 600, 1900, 0.6], [21, 3, 0.6, 1900, 700, 0.6], [25, 3, -0.6, 800, 2300, 0.55], [29, 3, 0.5, 1200, 450, 0.4],
];

// Groans (a slow sine glide with grit): [bar, bars, midiFrom, midiTo, vol, minLevel]
const groans = [[6, 3, 35, 34, 0.1, 0.55], [12, 3, 36, 34, 0.11, 0.55], [18, 2, 35, 33, 0.12, 0.55], [22, 4, 35, 32, 0.14, 0.55], [26, 3, 33, 35, 0.14, 0.55]];
// Low string cluster, a semitone apart, swelling into the pressure: [bar, bars, midi, vol, minLevel]
const cluster = [[20, 4, 47, 0.07, 0.55], [20, 4, 48, 0.06, 0.6], [24, 4, 47, 0.08, 0.55], [24, 4, 53, 0.06, 0.6], [24, 4, 48, 0.06, 0.65]];

const track = defineTrack({
  meta: {
    id: 'cinder', name: 'Cinder (Cinematic drift)', bpm: BPM, bars: BARS,
    description: 'B phrygian drift through burning debris: thin low pads, ember ticks, lone plucks in long tails, a rare dissonant horn, pressure building in the second half.',
  },
  score: { intensity, pads, bass, horn, plucks, heart, timp, swells, risers, air },
  adaptive: true, lvl0: 0.05,
  layers: { horn: 0.4, plucks: 0.25, heart: 0.55, timp: 0.7, risers: 0.4 },
  pad: { cut: [280, 1600], cents: 10, vol: 1.25 },
  delay: { l: 0.75, r: 1.5, fb: 0.66, lp: 2000 },
  reverb: { seed: 6262 },
  mix: { trim: 0.47, subVol: 0.15, hornVol: 0.12 },
  seed: 47,
  hook(api) {
    const { ac } = api;
    const emberBus = api.bus(0.55, 0.9, 0.45, null);
    const lowBus = api.bus(1, 0.25, 0, null);
    const GROAN_AT = new Map(), CLUS_AT = new Map();
    for (const e of groans) { if (!GROAN_AT.has(e[0])) GROAN_AT.set(e[0], []); GROAN_AT.get(e[0]).push(e); }
    for (const e of cluster) { if (!CLUS_AT.has(e[0])) CLUS_AT.set(e[0], []); CLUS_AT.get(e[0]).push(e); }
    return {
      bar(c) {
        const { t0, rng: r, I, lay } = c;
        // embers: a few tiny bright ticks at random moments, more of them as the level builds
        const n = 1 + Math.floor(r() * 2) + (lay(0.25, 0.43) > 0.5 ? 1 : 0) + (lay(0.6, 0.78) > 0.5 ? 2 : 0);
        for (let i = 0; i < n; i++) {
          noiseTick(ac, emberBus, t0 + r() * api.BAR, 0.02 + r() * 0.05, {
            type: 'bandpass', f: 2600 + r() * 4400, q: 3.5, vol: (0.045 + 0.05 * I) * (0.6 + r() * 0.8), pan: r() * 1.6 - 0.8, off: r(),
          });
        }
        for (const e of GROAN_AT.get(c.bar) || []) {
          const g = c.gate(e, 5, 'groan');
          if (g > 0.03) glideSub(ac, lowBus, t0, e[1] * api.BAR, e[2], e[3], e[4] * g);
        }
        for (const e of CLUS_AT.get(c.bar) || []) {
          const g = c.gate(e, 4, 'cluster');
          if (g > 0.03) lowString(ac, lowBus, t0, e[1] * api.BAR - 0.5, e[2], e[3] * g * (0.6 + 0.4 * I), { att: 2.4, rel: 2.4, cut: 520, cents: 7, pan: e[2] % 2 ? 0.3 : -0.3 });
        }
      },
    };
  },
});

export const meta = track.meta;
export const create = track.create;
