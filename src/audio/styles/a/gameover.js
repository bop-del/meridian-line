// Style A, game over stinger: C# aeolian, 66 BPM, 4 bars (about 15 s) that fade to nothing. Sombre and unresolved: a low
// C#m7 pad sinks into Amaj7/C# (the flat six over the tonic, never resolved), one horn phrase falls a fifth, the
// heartbeat slows and thins to one soft beat, a lone pluck and the reverb tail fade to silence.
import { defineTrack } from './shared/engine.js';
import { arc } from './shared/gen.js';

const BPM = 66, BARS = 4;
const BAR = (4 * 60) / BPM;

const intensity = arc([[0, 0.5], [1, 0.42], [2, 0.3], [3, 0.16]], BARS);

const pads = [
  [0, 2, [37, 44, 52, 59, 64]],          // C#m7: C# G# E B E
  [2, 2, [37, 45, 52, 56, 61]],          // Amaj7/C#: unresolved
];
const bass = [[0, 4, 25]];
const horn = [
  [0, 1, 68, 5],     // G#4
  [1, 3, 61, 6],     // down a fifth to C#4
  [3, 0, 57, 5],     // down a major third to A3, hanging
];
const plucks = [[1, 2, 76, 0.36], [2, 3, 71, 0.28], [3, 2, 64, 0.2]];
const heart = [[0, 0.7], [1, 0.55], [2, 0.4], [3, 0.26]];
const air = [[0, 3, -0.5, 500, 1300, 0.5]];

const track = defineTrack({
  meta: {
    id: 'gameover', name: 'Game over (Cinematic drift)', bpm: BPM, bars: BARS, loop: false, tail: 5,
    description: 'C# aeolian sombre fade: low C#m7 sinking into an unresolved Amaj7/C#, one falling horn phrase, a slowing heartbeat and a lone pluck.',
  },
  score: { intensity, pads, bass, horn, plucks, heart, air },
  adaptive: false,
  pad: { cut: [300, 1500], att: 1.8, rel: 3.0, vol: 1.1 },
  delay: { l: 0.75, r: 1.5, fb: 0.55, lp: 2000 },
  reverb: { seed: 3131, seconds: 4.0 },
  mix: { trim: 0.47, subVol: 0.16, hornVol: 0.13, heartVol: 0.9 },
  endFade: { at: BAR * 0.35, dur: 6.2 },
  seed: 9,
});

export const meta = track.meta;
export const create = track.create;
