// Style C, level theme "foundry": oppressive, mechanical, cold. F minor with a flat two, 72 BPM, 32 bars (107 s).
// The motif is played by low brass in very long notes: F Ab Gb C (a minor third up, a semitone down, an augmented fourth
// up). It works over Fm, Db and Bbm alike, so it just keeps returning, faster each time. A slow "machine" ostinato in the
// low strings runs a 3+3+2 grid of sixteenths, timpani land on the weight beats, a tam-tam breathes under the crest and
// thin glassy plucks and harmonics supply the cold. Dry hall (shorter, darker reverb) so it stays heavy, not washy.
//
//    0- 7  Idle: brass states the motif at four beats a note over an open fifth, tam-tam, sub pedal.    (F5, Gb, Fm)
//    8-15  Grind: the machine ostinato starts, motif at two beats a note, timpani, cold plucks.          (Fm, Db, Bbm, Gb, C5)
//   16-23  Weight: brass blocks on every chord, strings, motif again in long notes then doubled by horn. (Db, Eb, Fm, Gb)
//   24-31  Crush and exhale: horn and brass carry the motif high, crash and tam-tam, then it winds down  (Fm, Db, Gb, Bbm, F5)
//          to the open fifth.
//
// setIntensity layers: brass motif, pad and bass always; ostinato 0.2 to 0.45, timpani 0.25 to 0.5, strings and cold
// plucks 0.3 to 0.55, brass blocks 0.45 to 0.7, horn 0.55 to 0.8, noise 0.5 to 0.8.
import { Score, nn, nv } from './shared/kit.js';
import { createTrack } from './shared/track.js';

const BPM = 72, BARS = 32;
const CH = { // chord: [bass, pad voicing, brass block]
  F5: ['F2', 'C3 G3 C4 F4', 'F2 C3 F3'], Fm: ['F2', 'C3 Ab3 C4 F4', 'F2 C3 Ab3'], Gb: ['Gb2', 'Db3 Gb3 Bb3 Db4', 'Gb2 Db3 Bb3'],
  Db: ['Db2', 'Ab3 Db4 F4 Ab4', 'Db2 Ab2 F3'], Eb: ['Eb2', 'Bb3 Eb4 G4 Bb4', 'Eb2 Bb2 G3'], Bbm: ['Bb2', 'F3 Bb3 Db4 F4', 'Bb2 F3 Db4'],
  C5: ['C3', 'G3 C4 G4 C5', 'C3 G3 C4'],
};
const PROG = [['F5', 4], ['Gb', 2], ['Fm', 2], ['Fm', 2], ['Db', 2], ['Bbm', 2], ['Gb', 1], ['C5', 1],
  ['Db', 2], ['Eb', 2], ['Fm', 2], ['Gb', 2], ['Fm', 2], ['Db', 1], ['Gb', 1], ['Bbm', 2], ['F5', 2]];

const ARC = [
  0.34, 0.34, 0.34, 0.34, 0.34, 0.35, 0.36, 0.37,
  0.38, 0.40, 0.42, 0.43, 0.45, 0.46, 0.48, 0.50,
  0.55, 0.58, 0.62, 0.66, 0.70, 0.74, 0.78, 0.82,
  0.92, 0.96, 1.00, 1.00, 0.92, 0.80, 0.50, 0.38,
];

const S = new Score(BARS);
const chordAt = [];
{
  let bar = 0;
  for (const [name, n] of PROG) {
    const [bass, vo, blk] = CH[name];
    S.pad(bar, n, vo, 1); S.bass(bar, n, bass, 1);
    if (bar >= 16) for (const m of nv(blk)) S.add('brass', bar, 0, n * 4 - 0.3, m, 0.75, { attack: 0.45, layer: 'blk' });
    for (let i = 0; i < n; i++) chordAt[bar + i] = { name, bass: nn(bass), vo: nv(vo) };
    bar += n;
  }
  if (bar !== BARS) throw new Error('foundry progression length ' + bar);
}

// The motif on low brass: F Ab Gb C, `unit` beats per note, octave offset `oct`.
const H = (bar, unit, { oct = 0, kind = 'brass', v = 1, layer, o = {} } = {}) => {
  ['F2', 'Ab2', 'Gb2', 'C3'].forEach((n, i) => S.add(kind, bar, i * unit, unit - (kind === 'brass' ? 0.25 : 0.15), nn(n) + oct, v, { attack: unit >= 4 ? 0.45 : 0.3, ...(layer ? { layer } : {}), ...o }));
};
H(0, 4, { v: 0.9 });
H(8, 2); H(10, 2); H(12, 2, { oct: 12, kind: 'horn', v: 0.8 }); H(12, 2, { v: 0.85 }); H(14, 2);
H(16, 4); H(20, 2); H(20, 2, { oct: 12, kind: 'horn', v: 0.85 }); H(22, 2); H(22, 2, { oct: 12, kind: 'horn', v: 0.85 });
H(24, 4, { oct: 12, kind: 'horn', v: 1 }); H(24, 4, { v: 1 });
S.add('brass', 28, 0, 3.6, 'F2', 0.9, { attack: 0.5 }); S.add('brass', 29, 0, 3.6, 'Ab2', 0.8, { attack: 0.5 });
S.add('brass', 30, 0, 7.6, 'F2', 0.6, { attack: 0.8 });

// Machine ostinato on a 3+3+2 grid of sixteenths (16 slots per bar), heavier towards the crush.
const rootLo = (b) => chordAt[b].bass;
const G1 = [[0, 1], null, null, [0, 0.7], null, null, [0, 0.8], null, [0, 0.9], null, null, [0, 0.7], null, null, [7, 0.8], null];
const G2 = [[0, 1], null, null, [0, 0.8], null, null, [0, 0.9], null, [0, 1], null, null, [0, 0.8], null, null, [7, 0.9], [7, 0.6]];
const G3 = [[0, 1], null, [0, 0.5], [0, 0.85], null, [0, 0.55], [0, 0.95], null, [0, 1], null, [0, 0.5], [0, 0.85], null, [7, 0.7], [7, 0.9], [0, 0.5]];
const G4 = [[0, 0.8], null, null, [0, 0.6], null, null, [0, 0.6], null, null, null, null, null, null, null, null, null];
S.pat('ost', 8, 15, rootLo, G1, { vel: 0.8, opts: { hold: 0.03 } });
S.pat('ost', 16, 23, rootLo, G2, { vel: 0.9, opts: { hold: 0.03 } });
S.pat('ost', 24, 27, rootLo, G3, { vel: 1, opts: { hold: 0.02 } });
S.pat('ost', 28, 29, rootLo, G2, { vel: 0.8, opts: { hold: 0.03 } });
S.pat('ost', 30, 31, rootLo, G4, { vel: 0.7, opts: { hold: 0.03 } });
S.pat('ost', 4, 7, rootLo, [[0, 0.7], null, null, null, null, null, null, null, [0, 0.55], null, null, null, null, null, null, null], { vel: 0.7, opts: { hold: 0.05 } });

// Cold: glassy high string harmonics (very quiet, long) and short metallic plucks.
S.add('str', 8, 0, 16, 'C6', 0.5, { attack: 1.2, pan: -0.4 }); S.add('str', 8, 0, 16, 'G5', 0.4, { attack: 1.4, pan: 0.4 });
S.add('str', 16, 0, 16, 'Db6', 0.5, { attack: 1.2, pan: -0.4 }); S.add('str', 16, 0, 16, 'Ab5', 0.45, { attack: 1.4, pan: 0.4 });
S.add('str', 24, 0, 8, 'F6', 0.5, { attack: 0.8, pan: -0.4 }); S.add('str', 24, 0, 8, 'C6', 0.5, { attack: 0.8, pan: 0.4 });
S.add('str', 28, 0, 8, 'Ab5', 0.4, { attack: 1.4, pan: 0 });
const cold = [[9, 3.5, 'C6'], [11, 1.5, 'Ab5'], [13, 2.75, 'Eb6'], [15, 3.5, 'C6'], [17, 1.5, 'Ab5'], [18, 3.25, 'Db6'], [20, 2.5, 'C6'], [22, 1.75, 'Eb6'],
  [23, 3.5, 'Ab5'], [25, 2.5, 'C6'], [26, 3.5, 'F6'], [29, 2.75, 'Db6'], [31, 3.5, 'Ab5']];
for (const [b, bt, m] of cold) S.add('pluck', b, bt, 0.5, m, 0.55, { decay: 0.14, pan: (b % 3 - 1) * 0.5 });

// Timpani on the weight beats.
const tm = (b) => { let m = chordAt[b].bass; while (m < 36) m += 12; return m; };
const T = (bar, beat, v) => S.hit(bar, beat, tm(bar), v);
for (const b of [8, 10, 12, 14]) T(b, 0, 0.5);
T(15, 2, 0.4); S.roll(15, 3, 1, tm(15), 0.2, 0.6);
for (let b = 16; b <= 23; b++) { T(b, 0, 0.7 + (b - 16) * 0.02); if (b % 2) T(b, 2.5, 0.45); }
S.roll(23, 0, 4, tm(23), 0.3, 0.9);
for (let b = 24; b <= 27; b++) { T(b, 0, 1.0); T(b, 2, 0.7); T(b, 3.5, 0.5); }
T(28, 0, 0.9); T(29, 0, 0.7); T(30, 0, 0.45); T(31, 2, 0.25);
S.tam(0, 0, 0.5); S.tam(16, 0, 0.6); S.tam(24, 0, 1.0); S.tam(28, 0, 0.5);
S.crash(24, 0, 0.7); S.riser(22, 2, 0.6);

export const track = createTrack({
  meta: {
    id: 'foundry', name: 'Foundry', bpm: BPM, bars: BARS, loop: true,
    description: 'Style C level theme: oppressive F minor, low brass, a slow machine ostinato in the low strings, timpani and a tam-tam. Darker and drier than the others.',
  },
  score: S, arc: ARC,
  levels: {
    brass: [0.19, 10], horn: [0.14, 14], pad: [0.36, 22], str: [0.36, 18], bass: [0.15, 16], ost: [0.13, 20],
    pluck: [0.22, 10], timp: [0.24, 0], riser: [0.03, 0], crash: [0.02, 0], tam: [0.06, 0],
  },
  layers: {
    pad: { on: 0, full: 0.3, min: 0.75 }, ost: { on: 0.2, full: 0.45 }, timp: { on: 0.25, full: 0.5 }, str: { on: 0.3, full: 0.55 },
    pluck: { on: 0.3, full: 0.55 }, blk: { on: 0.45, full: 0.7 }, horn: { on: 0.55, full: 0.8 }, fx: { on: 0.5, full: 0.8 },
  },
  bassOpts: { sub: 0.35, lp: 320, grit: 0.35 },
  reverb: { seconds: 3.8, t60: 3.2, lp: 5200, hp: 130 }, wet: 0.85, masterGain: 0.58, xTrim: 2,
  bright: (a, x) => 1100 + 2600 * (0.6 * a + 0.4 * x),
});
export const meta = track.meta;
export const create = track.create;
