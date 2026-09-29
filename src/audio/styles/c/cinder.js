// Style C, level theme "cinder": a tense drift through burning debris. C# Phrygian, 78 BPM, 32 bars (98 s).
// The motif is a four note cell in the low winds: a tritone up, a semitone down, a major third down (C# G F# D), which
// keeps returning, then inverts on high tremolo strings. Sparse: bass clarinet and bassoon like winds, shimmering tremolo
// pad, isolated harp sparks, no melodic warmth. The pressure rises: heartbeat ticks in the low strings, timpani, a chromatic
// crawl of the bass (C# D E F# G) and tritone dyads climbing by semitone on the tremolo strings.
//
//    0- 7  Embers: winds state the cell, open fifth pad, harp sparks.                (C#5, D/C#, C#5)
//    8-15  Smoulder: the cell in shorter values, tremolo pad, first heartbeat.       (C#, A/C#, B/C#)
//   16-23  Pressure: horn in augmentation, high inverted cell on tremolo strings,    (C#, D/C#, D, E)
//          ostinato ticks, timpani, riser.
//   24-31  Crest: tritone dyads climb, bass reaches G, tam-tam, then collapse to an  (F#m, G, G b9, D/C#, C#5)
//          open fifth that leads back to bar 0.
//
// setIntensity layers: pad, bass, winds and sparks always; tremolo strings 0.25 to 0.5; ostinato ticks 0.3 to 0.55;
// horn 0.45 to 0.7; timpani 0.4 to 0.65; noise and tam-tam 0.55 to 0.85.
import { Score, nn, nv } from './shared/kit.js';
import { createTrack } from './shared/track.js';

const BPM = 78, BARS = 32;
const CH = { // chord: [bass, pad voicing]
  Cs: ['C#2', 'G#3 C#4 E4 G#4'], Fifth: ['C#2', 'G#3 C#4 G#4 C#5'], Dc: ['C#2', 'A3 D4 F#4 A4'], Ac: ['C#2', 'A3 C#4 E4 A4'], Bc: ['C#2', 'B3 D#4 F#4 B4'],
  D: ['D2', 'A3 D4 F#4 A4'], E: ['E2', 'B3 E4 G#4 B4'], Fsm: ['F#2', 'A3 C#4 F#4 A4'], G: ['G2', 'G3 D4 G4 B4'], Gb9: ['G2', 'G3 B3 D4 Ab4'],
};
const PROG = [['Fifth', 4], ['Dc', 2], ['Cs', 2], ['Cs', 4], ['Ac', 2], ['Bc', 2], ['Cs', 2], ['Dc', 2], ['D', 2], ['E', 2], ['Fsm', 2], ['G', 2], ['Gb9', 2], ['Dc', 1], ['Fifth', 1]];

const ARC = [
  0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.20,
  0.26, 0.28, 0.30, 0.33, 0.36, 0.38, 0.40, 0.43,
  0.48, 0.51, 0.54, 0.58, 0.62, 0.66, 0.70, 0.75,
  0.82, 0.86, 0.90, 0.94, 0.98, 1.00, 0.62, 0.30,
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
  if (bar !== BARS) throw new Error('cinder progression length ' + bar);
}

// The cell: tritone up, semitone down, major third down. inv flips the direction.
const cell = (root, inv = false) => (inv ? [root, root - 6, root - 5, root - 1] : [root, root + 6, root + 5, root + 1]);

// Winds (layer 'wind'): the cell in different rhythms and on different roots.
const w = (bar, root, rhythm, o = null) => { const n = cell(nn(root)); S.phrase('wind', bar, rhythm.map(([b, d], i) => [b, d, n[i % 4] ?? n[3], 1, o])); };
w(0, 'C#3', [[0, 2.5], [2.5, 2], [6, 1.5], [8, 4]]);           S.add('wind', 0, 13, 3, 'C#3', 0.8);
w(4, 'F#3', [[0, 2], [2, 2], [5, 1.5], [8, 3]]);               S.add('wind', 4, 12, 4, 'C#3', 0.8);
w(8, 'C#3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2]]);           w(10, 'C#3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2]]);
S.add('wind', 11, 2, 2, 'C#3', 0.8);
w(12, 'E3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2]]);           w(14, 'F#3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2]]);
S.add('wind', 15, 2, 2, 'G#3', 0.7);
w(20, 'D3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2.5]]);         w(22, 'E3', [[0, 1.5], [1.5, 1], [2.5, 1], [4, 2.5]]);
S.add('wind', 23, 2, 2, 'G3', 0.7);
// second wind, an octave down, shadowing the statements in the smoulder section
S.phrase('wind', 8, cell(nn('C#3')).slice(0, 2).map((m, i) => [[0, 1.5], [1.5, 1]][i].concat([m - 12, 0.7])));
S.phrase('wind', 10, cell(nn('C#3')).slice(0, 2).map((m, i) => [[0, 1.5], [1.5, 1]][i].concat([m - 12, 0.7])));


// The winds carry the cell in augmentation where the horn later joins (so the low intensity mix never goes empty).
S.phrase('wind', 16, cell(nn('C#4')).map((m, i) => [i * 4, 3.6, m, 0.75, { attack: 0.3 }]));
S.phrase('wind', 24, cell(nn('F#3')).map((m, i) => [i * 4, 3.6, m, 0.8, { attack: 0.3 }]));
S.phrase('wind', 28, cell(nn('G3')).map((m, i) => [i * 4, 3.6, m, 0.8, { attack: 0.3 }]));
// Horn in augmentation (layer 'horn'): cell at four beats a note, bars 16 to 19, and the low crawl in the crest.
S.phrase('horn', 16, cell(nn('C#3')).map((m, i) => [i * 4, 4, m, 0.9, { attack: 0.5 }]));
S.phrase('horn', 24, cell(nn('F#3')).map((m, i) => [i * 4, 4, m, 1, { attack: 0.45 }]));
S.phrase('horn', 28, cell(nn('G3')).map((m, i) => [i * 4, 4, m, 1, { attack: 0.45 }]));

// Tremolo strings (layer 'str'): inverted cell high and slow, then rising tritone dyads.
S.phrase('tstr', 16, cell(nn('E5'), true).map((m, i) => [i * 4, i === 3 ? 4 : 3.5, m, 0.8, { pan: i % 2 ? 0.35 : -0.35 }]));
S.phrase('tstr', 20, cell(nn('F5'), true).map((m, i) => [i * 4, i === 3 ? 4 : 3.5, m, 0.85, { pan: i % 2 ? 0.35 : -0.35 }]));
const dyad = (bar, lo, hi, v = 1) => { S.add('tstr', bar, 0, 8, lo, v, { pan: -0.3, attack: 0.5 }); S.add('tstr', bar, 0, 8, hi, v, { pan: 0.3, attack: 0.5 }); };
dyad(24, 'B4', 'F5'); dyad(26, 'C5', 'F#5'); dyad(28, 'C#5', 'G5', 1);
S.add('tstr', 30, 0, 8, 'D5', 0.7, { pan: -0.2, attack: 0.5 }); S.add('tstr', 30, 0, 8, 'G#4', 0.7, { pan: 0.2, attack: 0.5 });
// a low tremolo cello like bed under the smoulder section
S.add('tstr', 12, 0, 16, 'G#3', 0.6, { attack: 0.8 });

// Harp sparks (isolated, high, long decay).
const sparks = [[1, 3.5, 'G#5'], [3, 2.75, 'D6'], [5, 3.25, 'B5'], [7, 3.75, 'G#5'], [9, 1.5, 'F#5'], [9, 3.25, 'D6'], [11, 2.5, 'G#5'], [13, 3, 'C#6'],
  [14, 1.25, 'A5'], [15, 3.5, 'D6'], [17, 2.5, 'F#5'], [18, 3.75, 'C#6'], [19, 1.25, 'G5'], [21, 3.25, 'D6'], [22, 2.5, 'G#5'], [23, 3.5, 'C#6'],
  [25, 2.25, 'A5'], [27, 3.25, 'D6'], [29, 2.75, 'F6'], [31, 3.5, 'G#5']];
for (const [b, bt, m] of sparks) S.add('pluck', b, bt, 0.5, m, 0.7, { decay: 0.5 });

// Low string ticks (heartbeat) and pulse.
const rootHi = (b) => chordAt[b].bass + 12;
S.pat('ost', 12, 15, rootHi, [0, null, null, null, 0, null, null, null], { vel: 0.7, opts: { hold: 0.06 } });
S.pat('ost', 16, 19, rootHi, [0, null, 0, null, 0, null, 1, null], { vel: 0.85, opts: { hold: 0.04 } });
S.pat('ost', 20, 23, rootHi, [0, 0, null, 0, 0, null, 1, null], { vel: 0.95 });
S.pat('ost', 24, 29, rootHi, [0, 0, 0, 0, 0, 0, 0, 1], { vel: 1 });
S.pat('ost', 30, 30, rootHi, [0, null, null, null, 0, null, null, null], { vel: 0.6 });

// Timpani and noise.
const tm = (b) => { let m = chordAt[b].bass; while (m < 36) m += 12; return m; };
const T = (bar, beat, v) => S.hit(bar, beat, tm(bar), v);
T(12, 0, 0.35); T(16, 0, 0.45); T(18, 2, 0.4); S.roll(19, 0, 4, tm(19), 0.15, 0.6);
T(20, 0, 0.55); T(22, 0, 0.6); S.roll(23, 0, 4, tm(23), 0.3, 0.9);
T(24, 0, 0.85); T(25, 2, 0.5); T(26, 0, 0.9); T(27, 2, 0.55); T(28, 0, 0.95); T(29, 0, 0.7); T(29, 2, 0.7); S.roll(29, 3, 1, tm(29), 0.4, 1.0);
T(30, 0, 0.5); T(31, 2, 0.28);
S.riser(22, 2, 0.7); S.riser(26, 2, 0.55);
S.tam(24, 0, 0.8); S.tam(28, 0, 0.6);

export const track = createTrack({
  meta: {
    id: 'cinder', name: 'Cinder', bpm: BPM, bars: BARS, loop: true,
    description: 'Style C level theme: uneasy C# Phrygian drift, low winds, tremolo strings and harp sparks, with pressure that rises through the loop and the level.',
  },
  score: S, arc: ARC,
  levels: {
    wind: [0.18, 10], horn: [0.13, 14], tstr: [0.30, 20], str: [0.30, 20], pad: [0.36, 24], bass: [0.10, 20], ost: [0.11, 22],
    pluck: [0.07, 12], timp: [0.2, 0], riser: [0.03, 0], crash: [0.02, 0], tam: [0.05, 0],
  },
  layers: {
    pad: { on: 0, full: 0.3, min: 0.7 }, str: { on: 0.25, full: 0.5 }, ost: { on: 0.3, full: 0.55 }, horn: { on: 0.45, full: 0.7 },
    timp: { on: 0.4, full: 0.65 }, fx: { on: 0.55, full: 0.85 },
  },
  padOpts: { trem: 0.6, attack: 1.4 },
  reverb: { seconds: 4.6, t60: 4.2, lp: 6200 }, wet: 1.15, masterGain: 0.6, xTrim: 2,
  bright: (a, x) => 1300 + 3000 * (0.6 * a + 0.4 * x),
});
export const meta = track.meta;
export const create = track.create;
