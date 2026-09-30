// Title variant D: melodic techno. A minor, 124 BPM, 32 bars. See ./d/score.js for the score and ../styles/d/shared/track.js for the
// builder. Hypnotic rather than loud: a long soft kick, plucked arpeggio and a dark pad, rolling bass from the first groove.
import { makeMelodic } from '../styles/d/shared/track.js';
import { chords, progression, sections, motif, arpPatterns } from './d/score.js';

const track = makeMelodic({
  id: 'd', name: 'Techno', seed: 5, bpm: 124, fixed: true,
  description: 'Hypnotic melodic techno in A minor: a long soft kick, plucked arpeggio, dark pad and a sparse four note motif.',
  chords, progression, sections,
  arc: [[0, 0.2], [4, 0.35], [12, 0.7], [12.001, 0.3], [20, 0.85], [20.001, 1], [28, 1], [32, 0.2]],
  lp: [[0, 1500], [4, 4500], [4.001, 4500], [12, 12000], [12.001, 900], [19.9, 9000], [20, 14000], [28, 14000], [32, 1500]],
  rig: { trim: 0.2, seed: 5, revSec: 4.4, revLevel: 0.32, duckDepth: 0.4, levels: { kick: 0.9, drums: 1, bass: 1.2, pad: 0.6, arp: 2, lead: 1.6 } },
  kick: { f0: 160, f1: 66, len: 0.46, drive: 1.9, click: 0.2 },
  drumStyle: { percPat: '..x...x..x...x..' },
  perc: (rig, t, v, s, bar, { G }) => {
    if (G('tick') > 0.05) rig.metal(t, 2500 + 350 * ((s + bar) % 3), v * 1.70 * G('tick'), { dec: 0.03, vol: 0.1, cut: 5200, q: 1.4 });
    if (G('tom') > 0.05 && s === 14 && bar % 2) rig.tom(t, 92, v * G('tom'), 0.35, 0.2);
  },
  bass: { pat: (sec) => (sec.name === 'drop' ? '.rrf.rrr.rfr.rrf' : '..r...r...r...f.'), cut: [180, 460], vol: 0.15, len: 0.68, env: 2.1 },
  arp: { patterns: arpPatterns, cut: [520, 1300], vol: 0.075, env: 2.2, dec: 0.15, q: 2.2, rev: 0.12 },
  pad: { cut: [380, 1000], vol: 0.055 },
  motif: { vol: 0.047, notes: motif },
  impact: 0.7,
});
export const { meta, create, SCORE } = track;
