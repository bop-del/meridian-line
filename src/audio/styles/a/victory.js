// Style A, victory stinger: E lydian, 84 BPM, 8 bars (about 23 s) plus a natural tail. Restrained relief, not a fanfare:
// the pad opens on a bare Esus2, a lone horn climbs in fifths (B, F#, B), a soft timpani marks the resolution at bar 6,
// and the piece ends on an open Eadd9 (E B E B F# B) that rings out with a glass bell and long reverb.
import { defineTrack } from './shared/engine.js';
import { arc } from './shared/gen.js';
import { bell } from './shared/voices.js';

const BPM = 84, BARS = 8;

const intensity = arc([[0, 0.3], [3, 0.5], [4, 0.6], [6, 0.74], [7, 0.62]], BARS);

const pads = [
  [0, 2, [40, 47, 54, 59, 66]],          // Esus2: E B F# B F#
  [2, 2, [40, 54, 58, 61, 66]],          // F#/E: the lydian II, bright and unresolved
  [4, 2, [40, 52, 56, 59, 63]],          // Emaj7
  [6, 2, [40, 47, 52, 59, 66, 71]],      // Eadd9 open: the resolved chord
];
const bass = [[0, 8, 28]];
const horn = [
  [1, 0, 59, 4],     // B3
  [2, 0, 66, 6],     // up a fifth to F#4
  [4, 0, 71, 4],     // up a fifth to B4
  [5, 2, 68, 3],     // down a minor third to G#4
  [6, 0, 64, 10],    // down a fourth to E4, the tonic, long with vibrato
];
const plucks = [[3, 1, 78, 0.4], [4, 2, 71, 0.4], [5, 0, 80, 0.45], [6, 1, 76, 0.5], [6, 3, 83, 0.32], [7, 2, 71, 0.3]];
const timp = [[0, 0, 0.45, 0, 40], [4, 0, 0.55, 0, 40], [6, 0, 0.7, 0, 40]];
const risers = [[3, 1, 0.45], [5, 1, 0.25]];
const air = [[0, 3, -0.6, 700, 2000, 0.5], [4, 4, 0.5, 1800, 700, 0.55]];

const track = defineTrack({
  meta: {
    id: 'victory', name: 'Victory (Cinematic drift)', bpm: BPM, bars: BARS, loop: false, tail: 6,
    description: 'E lydian relief: bare Esus2 pad, a lone horn climbing in fifths, soft timpani and a resolved open Eadd9 with a long glass tail.',
  },
  score: { intensity, pads, bass, horn, plucks, timp, risers, air },
  adaptive: false,
  pad: { cut: [420, 2500], att: 1.6, rel: 3.0 },
  delay: { l: 0.75, r: 1.5, fb: 0.6 },
  reverb: { seed: 9191, seconds: 4.2 },
  mix: { trim: 0.47, hornVol: 0.14 },
  seed: 5,
  hook(api) {
    const bellBus = api.bus(0.5, 1.0, 0.4, null);
    return {
      bar(c) {
        if (c.bar === 6) bell(api.ac, bellBus, c.t0 + 0.3, 76, 0.5, -0.3, 6);
        if (c.bar === 6) bell(api.ac, bellBus, c.t0 + 2.2 * api.BEAT, 83, 0.32, 0.4, 5);
        if (c.bar === 7) bell(api.ac, bellBus, c.t0 + api.BEAT, 71, 0.3, 0.1, 6);
      },
    };
  },
});

export const meta = track.meta;
export const create = track.create;
