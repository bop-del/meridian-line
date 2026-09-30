// Style D boss theme: the peak of the set. F sharp minor with a flat second, 128 BPM, 32 bars, one full arrangement at full intensity.
// Heavier kick, driving rolling bass, darker pads; tension comes from filter and reverb automation, nothing screams.
import { makeMelodic, expand } from './shared/track.js';
import { makeChord, ladderPick } from './shared/util.js';

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
// chord names: 'Fm' here is F sharp minor (pitch class 6), the track is in F sharp minor
const chords = { Fm: C(6, 'm'), G: C(7, 'M'), D: C(2, 'sus2'), E: C(4, 'sus2'), A: C(9, 'M') };
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;
const TICK_F = [2000, 2700, 2300, 3200];

const track = makeMelodic({
  id: 'd-boss', name: 'Boss (melodic techno)', seed: 41, bpm: 128, fixed: true,
  description: 'Peak-time melodic techno in F sharp minor at 128 BPM: heavy kick, rolling bass, dark pads, tension through filter and reverb.',
  chords,
  progression: [...expand('Fm G'), ...expand('Fm G Fm E'), ...expand('D E G Fm'), ...expand('Fm G D E'), ...expand('Fm E')],
  sections: [
    ['intro', 4, 'kick hat pad drone tick'],
    ['groove', 8, 'kick hat oh shaker clap bass arp pad drone tick'],
    ['break', 8, 'pad drone arp swell tick'],
    ['drop', 8, 'kick hat oh shaker clap bass arp pad drone tick rim tom motif'],
    ['outro', 4, 'kick hat oh bass arp pad drone'],
  ],
  arc: [[0, 0.3], [4, 0.5], [12, 0.85], [12.001, 0.4], [20, 0.9], [20.001, 1], [28, 1], [32, 0.3]],
  lp: [[0, 2200], [4, 6500], [4.001, 6500], [12, 14000], [12.001, 800], [19.9, 9000], [20, 16000], [28, 16000], [32, 2200]],
  rig: { trim: 0.22, seed: 41, revSec: 4.2, revLevel: 0.3, duckDepth: 0.34, levels: { kick: 0.95, drums: 1, bass: 1.3, pad: 0.6, arp: 1.4, lead: 1.4, drone: 0.4 } },
  kick: { f0: 160, f1: 62, len: 0.42, drive: 2.3, click: 0.28, sweepT: 0.045, hold: 0.45 },
  drumStyle: { hatVol: 0.12, percPat: '.x.xx..x.x..x.x.' },
  perc: (rig, t, v, s, bar, { G }) => {
    if (G('tick') > 0.05) rig.metal(t, TICK_F[(s + bar) % 4], v * 2.21 * G('tick'), { dec: 0.035, vol: 0.12, cut: 4800, q: 1.4 });
    if (G('tom') > 0.05 && (s === 7 || s === 15)) rig.tom(t, bar % 2 ? 84 : 96, v * G('tom'), 0.35, 0.22);
  },
  bass: { pat: (sec) => (sec.name === 'intro' ? null : '.rrf.rrr.rfr.rrf'), cut: [170, 420], vol: 0.16, len: 0.68, env: 2.0, q: 1.8 },
  arp: {
    patterns: [
      [[0, 0], [2, 2], [3, 1], [6, 3], [8, 2], [10, 'b2'], [11, 2], [14, 4]],
      [[0, 0], [1, 0], [3, 2], [4, 1], [6, 3], [8, 2], [9, 4], [11, 3], [12, 1], [14, 'b2']],
    ],
    cut: [400, 1000], vol: 0.075, env: 2.1, dec: 0.13, q: 2.6, rev: 0.1,
    voice: { oscs: [{ type: 'sawtooth', det: -8, gain: 0.55 }, { type: 'square', det: 7, gain: 0.35 }], q: 2.6 },
  },
  pad: { cut: [300, 850], vol: 0.06, rev: 0.5 },
  drone: { vol: 0.065, cut: 240 },
  motif: { vol: 0.07, notes: (ch, bar) => (bar % 2 === 0 ? [[0, L(ch, 4), 4], [6, L(ch, 3), 4], [12, L(ch, 2), 6]] : null) },
  impact: 0.9,
});
export const { meta, create, SCORE } = track;
