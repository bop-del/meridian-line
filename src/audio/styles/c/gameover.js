// Style C, game over stinger: sombre, unresolved, fading. One shot, B minor, 76 BPM, 6 bars (19 s) plus a long tail.
// A low horn sings a falling line (a third down, a sixth down, a hesitant rise) over Bm, G, Em, Bm/D and G, and the last
// chord is F# with a suspended fourth that never settles. A single soft timpani beat like a pulse, a tam-tam, harp
// single notes far apart, and a level that keeps falling.
//
//    0- 3  Horn line over Bm G Em Bm/D, pad thin, one low harp note per bar.
//    4- 5  G, then F# sus4 hanging; everything fades, the timpani beats once.
import { Score } from './shared/kit.js';
import { createTrack } from './shared/track.js';

const BPM = 76, BARS = 6;
const CH = [
  ['B1', 'F#3 B3 D4 F#4'], ['G2', 'D3 G3 B3 D4'], ['E2', 'B3 E4 G4 B4'], ['D2', 'B3 D4 F#4 B4'], ['G2', 'D3 G3 B3 F#4'], ['F#2', 'F#3 B3 C#4 F#4'],
];
const ARC = [0.64, 0.60, 0.55, 0.50, 0.42, 0.34];

const S = new Score(BARS);
CH.forEach(([bass, vo], b) => {
  const last = b === BARS - 1;
  S.bass(b, 1, bass, b === 0 ? 0.8 : 1, 'bass', last ? { tail: 1.6, attack: 1 } : { tail: 0.6, attack: 0.7 });
  S.pad(b, 1, vo, b === 0 ? 0.8 : 1, 'pad', last ? { tail: 1.5, attack: 0.9 } : { tail: 0.7, attack: 0.8 });
});
S.phrase('horn', 0, [
  [0, 2.5, 'F#4'], [2.5, 1.5, 'D4'],
  [4, 3, 'B3'], [7.5, 0.5, 'A3'],
  [8, 1.5, 'G4'], [9.5, 2.5, 'E4'],
  [12, 2, 'F#4'], [14, 1, 'D4'],
  [16, 4, 'D4', 0.85],
  [20, 3, 'C#4', 0.7, { rel: 1.8, attack: 0.5 }],
], { attack: 0.4 });
S.phrase('str', 3, [[0, 4, 'B4', 0.5, { attack: 0.8, pan: -0.3 }], [4, 4, 'D5', 0.4, { attack: 0.8, pan: 0.3 }], [8, 7, 'F#4', 0.35, { attack: 0.9, rel: 2.2 }]]);
for (const [b, bt, m, v] of [[0, 3, 'B4', 0.5], [1, 3.5, 'D5', 0.4], [2, 3.25, 'G4', 0.4], [4, 3, 'F#4', 0.3]]) S.add('pluck', b, bt, 0.5, m, v, { decay: 0.6 });
S.hit(0, 0, 'B2', 0.35); S.hit(5, 0, 'B2', 0.28); S.hit(5, 2, 'B2', 0.14);
S.tam(0, 0, 0.5); S.tam(5, 0, 0.35);

export const track = createTrack({
  meta: {
    id: 'gameover', name: 'Game over', bpm: BPM, bars: BARS, loop: false, tail: 7,
    description: 'Style C game over stinger: B minor, low horn lament, thin strings, a single timpani pulse, ending on a hanging suspended chord that fades away.',
  },
  score: S, arc: ARC,
  levels: {
    horn: [0.15, 14], str: [0.34, 20], pad: [0.36, 22], bass: [0.09, 18], pluck: [0.07, 12], timp: [0.2, 0], tam: [0.05, 0],
  },
  reverb: { seconds: 5.0, t60: 4.4 }, wet: 1.3, masterGain: 0.95,
  bright: (a) => 1200 + 2800 * a,
});
export const meta = track.meta;
export const create = track.create;
