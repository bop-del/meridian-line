// Style C, victory stinger: dignified relief, no fanfare. One shot, E flat major, 76 BPM, 8 bars (25 s) plus a long hall
// tail. A solo horn breathes a lifting line (a sixth up, a step back, then a seventh up to the top), the strings take
// over and swell with the borrowed minor iv (Ab minor) as the one shadow, timpani roll into a soft crash and a harp
// gesture on the last chord, which rings out in the hall. Ends on a resolved E flat chord.
//
//    0- 3  Horn statement over Eb, Bb/D, Cm, Ab, pad enters at bar 1.
//    4- 6  Strings carry the line over Fm, Abm (mixture), Bb; timpani roll into bar 7.
//    7     Resolved Eb: hit, soft crash, tam-tam, harp cascade, long release.
import { Score, nn } from './shared/kit.js';
import { createTrack } from './shared/track.js';

const BPM = 76, BARS = 8;
const CH = [
  ['Eb2', 'G3 Bb3 Eb4 G4'], ['D2', 'F3 Bb3 D4 F4'], ['C2', 'G3 C4 Eb4 G4'], ['Ab2', 'C4 Eb4 Ab4 C5'],
  ['F2', 'Ab3 C4 F4 Ab4'], ['Ab2', 'Eb4 Ab4 B4 Eb5'], ['Bb2', 'F3 Bb3 D4 F4'], ['Eb2', 'G3 Bb3 Eb4 G4 Bb4'],
];
const ARC = [0.36, 0.42, 0.52, 0.62, 0.74, 0.86, 0.95, 0.84];

const S = new Score(BARS);
CH.forEach(([bass, vo], b) => {
  const last = b === BARS - 1;
  S.bass(b, 1, bass, b === 0 ? 0.7 : 1, 'bass', last ? { tail: 1.1, attack: 0.9 } : { tail: 0.5, attack: 0.5 });
  if (b > 0) S.pad(b, 1, vo, 1, 'pad', last ? { tail: 1.0, attack: 0.5 } : { tail: 0.6, attack: 0.6 });
});
S.pad(0, 1, CH[0][1], 0.8, 'pad', { tail: 0.6, attack: 0.9 });

// Horn statement (bars 0 to 3).
S.phrase('horn', 0, [
  [0, 1, 'Bb3'], [1, 2.5, 'G4'], [3.5, 0.5, 'F4'],
  [4, 2, 'D4'], [6, 2, 'Bb4'],
  [8, 1, 'G4'], [9, 1.5, 'Eb5'], [10.5, 1.5, 'C5'],
  [12, 2, 'Eb5'], [14, 2, 'C5'],
], { attack: 0.28 });
// Strings carry the line (bars 4 to 6), horn underneath, final resolution.
S.phrase('str', 4, [
  [0, 1.5, 'F4', 1, { attack: 0.22 }], [1.5, 2.5, 'C5', 1, { attack: 0.2 }],
  [4, 2, 'B4', 1, { attack: 0.2 }], [6, 2, 'Ab4', 1, { attack: 0.2 }],
  [8, 1, 'D5', 1, { attack: 0.16 }], [9, 3, 'F5', 1, { attack: 0.18 }],
  [12, 7, 'G5', 0.85, { attack: 0.45, rel: 1.6 }],
]);
S.phrase('str', 4, [[0, 1.5, 'F3', 0.55, { attack: 0.3, pan: 0.3 }], [1.5, 2.5, 'C4', 0.55, { attack: 0.3, pan: 0.3 }], [4, 2, 'B3', 0.55, { attack: 0.3, pan: 0.3 }], [6, 2, 'Ab3', 0.55, { attack: 0.3, pan: 0.3 }], [8, 4, 'Bb3', 0.6, { attack: 0.3, pan: 0.3 }]]);
S.phrase('horn', 4, [[8, 4, 'D4', 0.9, { attack: 0.3 }], [12, 8, 'Eb4', 1, { attack: 0.35, rel: 1.6 }]]);
S.add('horn', 7, 0, 6, 'Bb3', 0.7, { attack: 0.5, rel: 1.8 });

// Harp: a few leaping single plucks before, then the cascade on the last chord.
for (const [b, bt, m, v] of [[1, 3.25, 'D5', 0.5], [2, 3.25, 'G5', 0.5], [3, 3.5, 'Eb5', 0.55], [5, 3.25, 'Eb5', 0.5]]) S.add('pluck', b, bt, 0.5, m, v);
[['Eb3', 0.05, 0.7], ['Bb3', 0.3, 0.75], ['G4', 0.55, 0.8], ['Eb5', 0.8, 0.8], ['Bb5', 1.1, 0.75], ['G5', 1.5, 0.6]].forEach(([m, bt, v], i) => S.add('pluck', 7, bt, 0.5, m, v, { decay: 0.7, pan: (i % 2 ? 1 : -1) * 0.4 }));

// Timpani, noise.
S.roll(3, 2, 2, 'Ab2', 0.12, 0.45); S.hit(4, 0, 'F2', 0.6);
S.roll(6, 2, 2, 'Bb2', 0.2, 0.9); S.hit(7, 0, 'Eb2', 0.95);
S.riser(5, 2, 0.5); S.crash(7, 0, 0.5); S.tam(7, 0, 0.6);

export const track = createTrack({
  meta: {
    id: 'victory', name: 'Victory', bpm: BPM, bars: BARS, loop: false, tail: 7,
    description: 'Style C victory stinger: E flat major, solo horn then strings, a shadow of the minor iv, ending on a resolved chord that rings out in the hall.',
  },
  score: S, arc: ARC,
  levels: {
    horn: [0.15, 14], str: [0.34, 20], pad: [0.38, 22], bass: [0.09, 18], pluck: [0.07, 12], timp: [0.2, 0], riser: [0.03, 0], crash: [0.02, 0], tam: [0.05, 0],
  },
  reverb: { seconds: 5.2, t60: 4.6 }, wet: 1.25, masterGain: 0.78,
  bright: (a) => 1500 + 3300 * a,
});
export const meta = track.meta;
export const create = track.create;
