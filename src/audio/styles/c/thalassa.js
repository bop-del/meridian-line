// Style C, level theme "thalassa": wonder over an open sea. G Lydian (with Mixolydian and minor mixture touches),
// 90 BPM, 36 bars (96 s). The motif is a stack of rising fifths that lands on the Lydian sharp four (B F# C#, then a third
// back down in thirds), so it does not share the title's D G A F shape. Horn states it plainly, violins take it up,
// the peak (bars 24 to 31) has the strings carrying stacked fifths from G, the end breathes out into bar 0.
//
//    0- 7  Statement: solo horn, low pedal, sparse harp.            (G G D D Em7 Em7 C A)
//    8-15  Flow: new phrase in zigzag fifths, ostinato, harp.       (G G Bm7 C D Em7 F D)
//   16-23  Lift: mixture (Eb, Cm7), motif a fifth down, violins,    (Eb Eb Cm7 D G G Bm7 C)
//          timpani, cymbal swell into the peak.
//   24-31  Peak: strings carry the stacked fifths, Lydian II (A).   (G G D Em7 A C D D)
//   32-35  Release: motif recalled, harp, pad thins out.            (G G C D) -> bar 0
//
// setIntensity layers: pad and bass always; ost at 0.18 to 0.4, violins 0.3 to 0.55, timpani 0.35 to 0.6, viola pulse
// 0.45 to 0.65, cymbal swells above 0.5. The horn and harp always play.
import { Score, nn, nv } from './shared/kit.js';
import { createTrack } from './shared/track.js';
import { near } from './shared/voices.js';

const BPM = 90, BARS = 36;
const CH = { // chord: [bass, pad voicing]
  G: ['G2', 'B3 F#4 A4 D5'], D: ['D2', 'A3 F#4 A4 D5'], Em7: ['E2', 'B3 D4 G4 B4'], C: ['C2', 'G3 E4 G4 D5'],
  A: ['A2', 'C#4 E4 B4 E5'], Bm7: ['B2', 'B3 F#4 A4 D5'], F: ['F2', 'C4 F4 A4 C5'], Eb: ['Eb2', 'Bb3 Eb4 G4 Bb4'],
  Cm7: ['C2', 'G3 Eb4 G4 Bb4'],
};
const PROG = [['G', 2], ['D', 2], ['Em7', 2], ['C', 1], ['A', 1],
  ['G', 2], ['Bm7', 1], ['C', 1], ['D', 1], ['Em7', 1], ['F', 1], ['D', 1],
  ['Eb', 2], ['Cm7', 1], ['D', 1], ['G', 2], ['Bm7', 1], ['C', 1],
  ['G', 2], ['D', 1], ['Em7', 1], ['A', 1], ['C', 1], ['D', 2],
  ['G', 2], ['C', 1], ['D', 1]];

const ARC = [
  0.40, 0.40, 0.40, 0.41, 0.41, 0.42, 0.43, 0.44,
  0.50, 0.52, 0.55, 0.57, 0.60, 0.62, 0.64, 0.66,
  0.68, 0.70, 0.72, 0.75, 0.78, 0.80, 0.83, 0.87,
  0.95, 0.97, 1.00, 1.00, 1.00, 1.00, 0.97, 0.92,
  0.72, 0.58, 0.50, 0.40,
];

const S = new Score(BARS);
const chordAt = [];
{
  let bar = 0;
  for (const [name, n] of PROG) {
    const [bass, vo] = CH[name];
    S.pad(bar, n, vo, 1); S.bass(bar, n, bass, 1);
    for (let i = 0; i < n; i++) chordAt[bar + i] = { name, bass: nn(bass), vo: nv(vo) };
    bar += n;
  }
  if (bar !== BARS) throw new Error('thalassa progression length ' + bar);
}

// Melody: horn always, violins double an octave up in the lift and the peak (layer 'str').
function melody(bar, notes, { dbl = null, dblV = 0.55, low = 0 } = {}) {
  S.phrase('horn', bar, notes);
  if (dbl !== null) {
    const up = notes.filter((n) => n[2] !== '_').map(([b, d, m, v = 1]) => [b, d, nn(m) + dbl, v * dblV, { attack: 0.12, pan: -0.25, vib: 9 }]);
    S.phrase('str', bar, up);
  }
  if (low) {
    const lw = notes.filter((n) => n[2] !== '_').map(([b, d, m, v = 1]) => [b, d, nn(m) - 12, v * low, { attack: 0.14, pan: 0.25, vib: 8 }]);
    S.phrase('str', bar, lw);
  }
}

// A: statement (bars 0 to 7)
melody(0, [[0, 1, 'B3'], [1, 1.75, 'F#4'], [3, 4, 'C#5'], [8, 1.5, 'A4'], [10, 1, 'F#4'], [12, 4, 'D4']]);
melody(4, [[0, 1, 'E4'], [1, 1.75, 'B4'], [3, 3, 'D5'], [8, 2, 'G4'], [10, 1.5, 'C5'], [12, 4, 'C#5']]);
// B: flow (bars 8 to 15)
melody(8, [[0, 1.5, 'D5'], [1.5, 1.5, 'A4'], [4, 1, 'E5'], [5, 3, 'B4'], [8, 1.5, 'D5'], [10, 1, 'G4'], [12, 3, 'E5']], { dbl: 12, dblV: 0.5 });
melody(12, [[0, 1.5, 'A4'], [1.5, 1.5, 'D5'], [4, 2, 'B4'], [6, 1, 'G4'], [8, 3, 'A4'], [12, 2, 'F#4']], { dbl: 12, dblV: 0.5 });
// C: lift (bars 16 to 23)
melody(16, [[0, 1, 'Bb3'], [1, 1.75, 'F4'], [3, 4, 'C5'], [8, 1.5, 'G4'], [10, 1, 'Eb4'], [12, 3, 'A4']], { dbl: 12, dblV: 0.6 });
melody(20, [[0, 1, 'B3'], [1, 1.75, 'F#4'], [3, 4, 'C#5'], [8, 1.5, 'A4'], [10, 1, 'F#4'], [12, 4, 'E4']], { dbl: 12, dblV: 0.7 });
// D: peak (bars 24 to 31), strings carry the stacked fifths, horn holds the line
melody(24, [[0, 1, 'G4'], [1, 1.75, 'D5'], [3, 4, 'A5'], [8, 1.5, 'F#5'], [10, 1, 'D5'], [12, 4, 'B4']], { dbl: 0, dblV: 1, low: 0.5 });
melody(28, [[0, 1, 'E4'], [1, 1.75, 'B4'], [3, 4, 'F#5'], [8, 1.5, 'D5'], [10, 1, 'A4'], [12, 4, 'F#4']], { dbl: 0, dblV: 1, low: 0.5 });
// E: release (bars 32 to 35)
melody(32, [[0, 1, 'B3'], [1, 1.75, 'F#4'], [3, 5, 'C#5'], [8, 3, 'E4'], [12, 4, 'F#4']]);

// Harp plucks (few, leaping): [beat, chord tone index, target midi, velocity]
const pl = (bar, list) => { const c = chordAt[bar]; for (const [b, i, tgt, v] of list) S.add('pluck', bar, b, 0.5, near(c.vo[i] % 12, tgt), v); };
for (const b of [1, 3, 5, 7]) pl(b, [[3, 2, 76, 0.7]]);
for (const b of [9, 11, 13, 15]) pl(b, [[2.5, 1, 72, 0.6], [3.25, 2, 79, 0.8]]);
for (const b of [16, 18, 20, 22]) pl(b, [[3, 3, 76, 0.5]]);
for (const b of [17, 19, 21, 23]) pl(b, [[2.5, 1, 74, 0.6], [3.25, 2, 81, 0.75]]);
for (let b = 24; b <= 31; b++) pl(b, [[1.5, 1, 72, 0.5], [2.5, 3, 83, 0.7], [3.5, 2, 78, 0.6]]);
for (const b of [33, 35]) pl(b, [[3.25, 2, 74, 0.6]]);

// Low string ostinato (8ths on root and fifth) and viola off beat pulse.
const rootHi = (b) => chordAt[b].bass + 12;
S.pat('ost', 8, 15, rootHi, [0, null, 7, null, 0, null, 7, null], { vel: 0.85 });
S.pat('ost', 16, 23, rootHi, [0, 0, 7, 0, 0, 0, 7, 0]);
S.pat('ost', 24, 30, rootHi, [0, 0, 7, 0, 0, 0, 7, 12]);
S.pat('ost', 31, 31, rootHi, [0, 0, 7, 0, null, null, null, null]);
S.pat('ost', 32, 33, rootHi, [0, null, 7, null, 0, null, null, null], { vel: 0.8 });
const third = (b) => near(chordAt[b].vo[1] % 12, 66);
S.pat('spic', 20, 22, third, [null, 0, null, 0, null, 0, null, 0]);
S.pat('spic', 24, 30, third, [null, 0, null, 0, null, 0, null, 0]);

// Timpani (on the chord root) and swells.
const tm = (b) => { let m = chordAt[b].bass; while (m < 36) m += 12; return m; };
const T = (bar, beat, v) => S.hit(bar, beat, tm(bar), v);
T(8, 0, 0.5); T(12, 0, 0.5); S.roll(15, 0, 4, tm(15), 0.2, 0.75);
T(16, 0, 0.7); T(20, 0, 0.7); T(22, 0, 0.6); S.roll(23, 0, 4, tm(23), 0.3, 1.0);
T(24, 0, 1.0); T(26, 0, 0.8); T(28, 0, 0.9); T(29, 0, 0.6); S.roll(31, 0, 4, tm(31), 0.25, 0.6);
T(32, 0, 0.4); T(35, 2, 0.18);
S.riser(14, 2, 0.5); S.riser(22, 2, 1.0);
S.crash(16, 0, 0.25); S.crash(24, 0, 1.0); S.crash(28, 0, 0.35);

export const track = createTrack({
  meta: {
    id: 'thalassa', name: 'Thalassa', bpm: BPM, bars: BARS, loop: true,
    description: 'Style C level theme: G Lydian wonder over an open sea. Solo horn and harp, strings and timpani building with the level progress.',
  },
  score: S, arc: ARC,
  levels: {
    horn: [0.13, 14], str: [0.34, 20], pad: [0.38, 24], bass: [0.085, 20], ost: [0.11, 24], spic: [0.06, 24],
    pluck: [0.06, 16], timp: [0.2, 0], riser: [0.03, 0], crash: [0.02, 0],
  },
  layers: {
    pad: { on: 0, full: 0.3, min: 0.5 }, ost: { on: 0.18, full: 0.4 }, str: { on: 0.3, full: 0.55 }, timp: { on: 0.35, full: 0.6 },
    pulse: { on: 0.45, full: 0.65 }, fx: { on: 0.5, full: 0.8 },
  },
  reverb: { seconds: 4.2, t60: 3.7 }, wet: 1.1, masterGain: 0.68, xTrim: 3,
  bright: (a, x) => 1500 + 3300 * (0.55 * a + 0.45 * x),
});
export const meta = track.meta;
export const create = track.create;
