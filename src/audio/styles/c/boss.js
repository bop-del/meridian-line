// Style C, boss theme: driving, dangerous, always at full energy but restrained (no drum kit, brass stabs kept short).
// A minor with a flat two (Bb) and a major dominant (E), 124 BPM, 32 bars (62 s). The motif is a fifth up, a tritone down
// and a semitone down (A E Bb A), stated by horn and violins and marched through the chord roots. Eighth note low string
// ostinato (sixteenths in the second half) and timpani provide the drive, tremolo strings the fear.
//
//    0- 7  Advance: horn and low strings state the motif, quarter note timpani.        (Am Am Bb Am F Dm Bb E)
//    8-15  Pursuit: violins double, spiccato pulse, brass stabs, timpani on every beat. (Am Am Bb Am F G Bb E)
//   16-23  Tension (the B section): sixteenth ostinato, cells in eighths climbing,        (Dm Dm Bb Bb F E Bb E)
//          tremolo strings hold E then F, riser, rolls.
//   24-31  Full: strings carry the motif at the top, crash, stabs, then E major pushes    (Am Am Bb F Dm Bb E E)
//          back into bar 0.
// No layering (bosses always run at intensity 1).
import { Score, nn, nv } from './shared/kit.js';
import { createTrack } from './shared/track.js';

const BPM = 124, BARS = 32;
const CH = { // chord: [bass, pad voicing]
  Am: ['A1', 'E3 A3 C4 E4'], Bb: ['Bb1', 'F3 Bb3 D4 F4'], F: ['F2', 'C3 F3 A3 C4'], Dm: ['D2', 'A3 D4 F4 A4'], E: ['E2', 'B3 E4 G#4 B4'], G: ['G2', 'D4 G4 B4 D5'],
};
const PROG = [['Am', 2], ['Bb', 1], ['Am', 1], ['F', 1], ['Dm', 1], ['Bb', 1], ['E', 1],
  ['Am', 2], ['Bb', 1], ['Am', 1], ['F', 1], ['G', 1], ['Bb', 1], ['E', 1],
  ['Dm', 2], ['Bb', 2], ['F', 1], ['E', 1], ['Bb', 1], ['E', 1],
  ['Am', 2], ['Bb', 1], ['F', 1], ['Dm', 1], ['Bb', 1], ['E', 2]];

const ARC = [
  0.72, 0.72, 0.74, 0.74, 0.78, 0.78, 0.80, 0.82,
  0.86, 0.86, 0.88, 0.88, 0.90, 0.90, 0.92, 0.94,
  0.92, 0.94, 0.96, 0.98, 1.00, 1.00, 1.00, 1.00,
  1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.94, 0.90,
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
  if (bar !== BARS) throw new Error('boss progression length ' + bar);
}

// The cell on a root: root, +7, +1, root. Two rhythms (beats): steady and pushed.
const R1 = [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]];
const R2 = [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]];
const cellNotes = (root, rhythm, at = 0) => rhythm.map(([b, d], i) => [at + b, d, [root, root + 7, root + 1, root][i]]);
const line = (kind, bar, roots, opts = {}) => roots.forEach((r, i) => {
  if (r == null) return;
  const notes = cellNotes(nn(r), i % 2 ? R2 : R1).map(([b, d, m]) => [b, d, m, opts.v ?? 1, opts.o]);
  S.phrase(kind, bar + i, notes);
});
// Horn states the marched cell (A E Bb A) on the chord roots; violins join from bar 8 and take it over at the top.
line('horn', 0, ['A3', 'C4', 'Bb3', 'A3', 'F3', 'D4', 'Bb3', 'E4'], { o: { attack: 0.12 } });
line('horn', 8, ['A3', 'C4', 'Bb3', 'A3', 'F3', 'G3', 'Bb3', 'E4'], { o: { attack: 0.1 } });
line('str', 8, ['A4', 'C5', 'Bb4', 'A4', 'F4', 'G4', 'Bb4', 'E5'], { v: 0.7, o: { attack: 0.06, pan: -0.25, vib: 6 } });
// Tension: quick cells in eighths, two per bar, climbing.
const quick = (kind, bar, roots, opts = {}) => roots.forEach((pair, i) => pair.forEach((r, j) => {
  const n = nn(r); const at = j * 2;
  [[0, 0.5, n], [0.5, 0.5, n + 7], [1, 0.5, n + 1], [1.5, 0.5, n]].forEach(([b, d, m]) => S.add(kind, bar + i, at + b, d, m, opts.v ?? 1, opts.o));
}));
quick('horn', 16, [['D4', 'D4'], ['F4', 'F4'], ['Bb3', 'D4'], ['D4', 'F4'], ['F4', 'A4'], ['E4', 'G#4'], ['Bb3', 'D4'], ['E4', 'G#4']], { o: { attack: 0.05 } });
quick('str', 16, [['D5', 'D5'], ['F5', 'F5'], ['Bb4', 'D5'], ['D5', 'F5'], ['F5', 'A5'], ['E5', 'G#5'], ['Bb4', 'D5'], ['E5', 'G#5']], { v: 0.6, o: { attack: 0.04, pan: -0.25, vib: 0 } });
// Full: strings carry the cell high, horn below, low strings in unison.
line('str', 24, ['A4', 'C5', 'Bb4', 'F4', 'D5', 'Bb4', 'E5', 'E5'], { v: 1, o: { attack: 0.05, pan: -0.25, vib: 6 } });
line('str', 24, ['A3', 'C4', 'Bb3', 'F3', 'D4', 'Bb3', 'E4', 'E4'], { v: 0.6, o: { attack: 0.06, pan: 0.25, vib: 6 } });
line('horn', 24, ['A3', 'C4', 'Bb3', 'F3', 'D4', 'Bb3', 'E4', 'E4'], { v: 1, o: { attack: 0.08 } });

// Tremolo strings (the fear): a held E over the tension, its flat two above it, back to E.
S.add('tstr', 16, 0, 16, 'E5', 0.7, { pan: 0.3, attack: 0.4 });
S.add('tstr', 20, 0, 12, 'F5', 0.8, { pan: -0.3, attack: 0.3 });
S.add('tstr', 23, 0, 4, 'E5', 0.8, { pan: 0.3, attack: 0.2 });
S.add('tstr', 28, 0, 16, 'B4', 0.6, { pan: 0.3, attack: 0.4 });

// Low string ostinato: eighths on the root, semitone flick on the last slot of odd bars; sixteenths in the tension.
const rootLo = (b) => chordAt[b].bass + 12;
const O8 = [[0, 1], [0, 0.55], [0, 0.8], [0, 0.55], [0, 0.95], [0, 0.55], [0, 0.8], [0, 0.6]];
const O8f = [[0, 1], [0, 0.55], [0, 0.8], [0, 0.55], [0, 0.95], [0, 0.55], [0, 0.8], [1, 0.7]];
const O16 = [[0, 1], [0, 0.4], [0, 0.6], [0, 0.4], [0, 0.85], [0, 0.4], [0, 0.6], [0, 0.4], [0, 0.95], [0, 0.4], [0, 0.6], [0, 0.4], [0, 0.85], [0, 0.4], [0, 0.7], [1, 0.55]];
for (let b = 0; b < BARS; b++) {
  if (b >= 16 && b <= 23) S.pat('ost', b, b, rootLo, O16, { vel: 0.9 });
  else S.pat('ost', b, b, rootLo, b % 2 ? O8f : O8, { vel: b < 8 ? 0.85 : 1 });
}
// Viola pulse on the offbeat sixteenths (from bar 8), on the chord fifth.
const fifth = (b) => { let m = chordAt[b].vo[2]; while (m > 70) m -= 12; while (m < 60) m += 12; return m; };
for (let b = 8; b < BARS; b++) S.pat('spic', b, b, fifth, [null, null, [0, 0.7], null, null, null, [0, 0.6], null, null, null, [0, 0.7], null, null, null, [0, 0.6], null], { vel: b >= 16 && b <= 23 ? 1 : 0.85 });

// Brass stabs (kept restrained): chord on the change, an offbeat answer.
for (let b = 8; b < BARS; b++) {
  const c = chordAt[b];
  if (S.pads.has(b)) for (const m of c.vo) S.add('brass', b, 0, 0.9, m, 0.75, { stab: true, attack: 0.03 });
  if (b % 4 === 3) for (const m of c.vo.slice(0, 3)) S.add('brass', b, 3.5, 0.45, m, 0.6, { stab: true, attack: 0.025 });
}

// Timpani.
const tm = (b) => { let m = chordAt[b].bass; while (m < 36) m += 12; return m; };
const T = (bar, beat, v) => S.hit(bar, beat, tm(bar), v);
for (let b = 0; b < BARS; b++) {
  if (b < 8) { T(b, 0, 0.8); T(b, 2, 0.55); }
  else if (b < 16 || b >= 24) { T(b, 0, 0.9); T(b, 1, 0.4); T(b, 2, 0.65); T(b, 3, 0.4); }
  else { T(b, 0, 0.9); T(b, 1, 0.5); T(b, 2, 0.7); T(b, 3, 0.5); T(b, 3.5, 0.35); }
}
S.roll(7, 3, 1, tm(7), 0.3, 0.7); S.roll(15, 2, 2, tm(15), 0.3, 0.9); S.roll(23, 2, 2, tm(23), 0.4, 1.0); S.roll(31, 2, 2, tm(31), 0.4, 1.0);
S.riser(14, 2, 0.8); S.riser(22, 2, 1.0); S.riser(30, 2, 0.8);
S.crash(8, 0, 0.5); S.crash(16, 0, 0.6); S.crash(24, 0, 1.0); S.tam(16, 0, 0.5);

export const track = createTrack({
  meta: {
    id: 'boss', name: 'Boss', bpm: BPM, bars: BARS, loop: true,
    description: 'Style C boss theme: A minor, eighth note low string ostinato, timpani, restrained brass stabs and a horn and violin motif. Always full energy.',
  },
  score: S, arc: ARC,
  levels: {
    horn: [0.14, 10], str: [0.30, 14], tstr: [0.24, 14], brass: [0.13, 8], pad: [0.32, 16], bass: [0.11, 14], ost: [0.12, 16], spic: [0.07, 14],
    pluck: [0.06, 10], timp: [0.22, 0], riser: [0.03, 0], crash: [0.02, 0], tam: [0.04, 0],
  },
  padOpts: { trem: 0.5, tremRate: 9, attack: 0.5 },
  reverb: { seconds: 3.6, t60: 3.0 }, wet: 0.9, masterGain: 0.5,
  bright: (a) => 1700 + 3300 * a,
});
export const meta = track.meta;
export const create = track.create;
