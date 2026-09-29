// Style A, level theme "thalassa": A lydian (the raised fourth D# is the bright colour), 78 BPM, 32 bars (about 98 s).
// Luminous open water: airy detuned pads over an A pedal, a lone horn on wide leaps (fifths and sixths, long rests),
// sparse FM plucks in the delay, low surf, soft timpani only at the phrase peaks. Layers arrive with level progress
// (setIntensity): 0 pad, sub, air, surf and the first plucks; 0.3 horn; 0.45 denser plucks; 0.6 risers; 0.7 timpani.
import { defineTrack } from './shared/engine.js';
import { arc, arpGen, chordAtFn } from './shared/gen.js';
import { mulberry32 } from '../../title/a/voices.js';

const BPM = 78, BARS = 32;

const intensity = arc([[0, 0.14], [3, 0.24], [4, 0.3], [11, 0.5], [12, 0.5], [19, 0.74], [20, 0.9], [22, 1], [25, 0.94], [27, 0.8], [28, 0.55], [31, 0.16]], BARS);

// Open voicings, no pop progression: A pedal for the first half, then the lydian II and vi colours.
const pads = [
  [0, 2, [45, 52, 59, 61, 64]],          // Aadd9
  [2, 2, [45, 56, 59, 63, 68]],          // Amaj7(9, #11) no third: G#m over A
  [4, 2, [45, 57, 63, 66, 71]],          // B major over A (lydian II)
  [6, 2, [45, 52, 59, 64, 73]],          // Aadd9, high C#
  [8, 2, [54, 59, 61, 64, 71]],          // F#m11
  [10, 2, [52, 59, 64, 66, 71]],         // Eadd9
  [12, 2, [47, 54, 63, 66, 71]],         // B major
  [14, 2, [49, 56, 61, 64, 68]],         // C#m7
  [16, 2, [45, 52, 61, 64, 69, 76]],     // Aadd9, wide
  [18, 1, [52, 56, 59, 64, 68]],         // E major
  [19, 1, [47, 54, 59, 64, 66]],         // Bsus4, leaning into the peak
  [20, 2, [45, 52, 59, 61, 64, 69]],     // Amaj9 full
  [22, 2, [47, 54, 59, 63, 66, 71]],     // Bmaj7 sus colour
  [24, 2, [40, 52, 59, 64, 66, 71]],     // Eadd9 low
  [26, 2, [49, 56, 61, 64, 68, 73]],     // C#m9
  [28, 2, [45, 52, 59, 64, 69]],         // Aadd9
  [30, 2, [45, 56, 59, 63, 68]],         // Amaj7 #11 shell, leads back into bar 0
];

const bass = [
  [0, 4, 33], [4, 4, 33], [8, 2, 30], [10, 2, 28], [12, 2, 35], [14, 2, 37], [16, 2, 33], [18, 1, 40], [19, 1, 35],
  [20, 2, 33], [22, 2, 35], [24, 2, 28], [26, 2, 37], [28, 4, 33],
];

// Lone horn: [bar, beat, midi, beats]. Fifths, sixths and one high lydian D#.
const horn = [
  [8, 0, 64, 6],     // E4
  [9, 2, 71, 6],     // up a fifth to B4
  [11, 2, 66, 4],    // down a fifth to F#4
  [12, 0, 57, 4],    // A3
  [13, 0, 66, 3],    // up a major sixth to F#4
  [14, 2, 75, 6],    // up a major sixth to D#5: the raised fourth, the bright moment
  [16, 0, 71, 3],    // B4
  [17, 0, 64, 4],    // down a fifth to E4
  [18, 2, 73, 5],    // C#5
  [20, 0, 69, 8],    // A4, long, vibrato
  [21, 2, 73, 6],    // C#5
  [23, 2, 78, 6],    // up a fourth to F#5, the peak
  [25, 2, 71, 6],    // down a fifth to B4
  [29, 0, 64, 8],    // E4, faint echo
];

// Plucks: sparse leaping arpeggios over the chord tones, density grows with the level (tiers), fixed by seed.
const chordAt = chordAtFn(pads);
const grid = [0, 0.75, 1.5, 2, 2.75, 3.5];
const rng = mulberry32(7719);
const plucks = [
  ...arpGen({ rng, from: 2, to: 12, poolAt: chordAt, count: (b) => (b < 4 ? 1 : 2), grid, lo: 64, hi: 88, vel: [0.34, 0.5], tiers: [0.1, 0.45] }),
  ...arpGen({ rng, from: 12, to: 20, poolAt: chordAt, count: () => 3, grid, lo: 64, hi: 88, vel: [0.36, 0.52], tiers: [0.1, 0.35, 0.55] }),
  ...arpGen({ rng, from: 20, to: 28, poolAt: chordAt, count: () => 4, grid, lo: 64, hi: 90, vel: [0.38, 0.55], tiers: [0.1, 0.3, 0.5, 0.75] }),
  ...arpGen({ rng, from: 28, to: 32, poolAt: chordAt, count: (b) => (b < 30 ? 2 : 1), grid, lo: 66, hi: 88, vel: [0.28, 0.4], tiers: [0.1, 0.4] }),
];

const timp = [[4, 0, 0.3, 0.7, 45], [12, 0, 0.42, 0.7, 45], [20, 0, 0.8, 0.7, 45], [24, 0, 0.5, 0.7, 40], [28, 0, 0.28, 0.7, 45]];
const heart = [[22, 0.5, 0.85], [24, 0.55, 0.85], [26, 0.45, 0.85]];
const risers = [[3, 1, 0.45, 0.5], [11, 1, 0.55, 0.5], [18, 2, 0.8, 0.5], [27, 1, 0.5, 0.5], [31, 1, 0.28]];
const swells = [{ bar: 19, beat: 0, beats: 8 }].map((s) => [s.bar, s.beat, s.beats, 33]);
const air = [
  [1, 3, -0.6, 700, 1900, 0.5], [5, 3, 0.6, 1800, 700, 0.5], [9, 3, -0.5, 800, 2300, 0.55], [13, 3, 0.5, 2000, 900, 0.6],
  [17, 2, -0.6, 900, 2800, 0.6], [21, 3, 0.6, 2600, 1100, 0.6], [25, 3, -0.6, 1100, 3000, 0.5], [29, 3, 0.5, 1800, 700, 0.4],
];
// Low surf (brown noise through a rising then falling lowpass): the sea under the whole level.
const surf = [
  [0, 4, -0.3, 160, 650, 0.6], [4, 4, 0.3, 700, 180, 0.6], [8, 4, -0.3, 180, 800, 0.7], [12, 4, 0.3, 850, 200, 0.7],
  [16, 4, -0.3, 200, 900, 0.8], [20, 4, 0.3, 950, 220, 0.9], [24, 4, -0.3, 220, 900, 0.8], [28, 4, 0.3, 850, 160, 0.6],
];

const track = defineTrack({
  meta: {
    id: 'thalassa', name: 'Thalassa (Cinematic drift)', bpm: BPM, bars: BARS,
    description: 'A lydian open water: airy detuned pads over an A pedal, a lone horn on wide leaps, sparse FM plucks in the delay, soft surf and timpani at the peak.',
  },
  score: { intensity, pads, bass, horn, plucks, timp, heart, risers, swells, air, surf },
  adaptive: true, lvl0: 0.05,
  layers: { horn: 0.3, plucks: 0.1, heart: 0.75, timp: 0.7, risers: 0.5 },
  pad: { cut: [400, 2700] },
  delay: { l: 0.75, r: 1.0, fb: 0.6 },
  reverb: { seed: 5151 },
  mix: { trim: 0.47 },
  seed: 31,
});

export const meta = track.meta;
export const create = track.create;
