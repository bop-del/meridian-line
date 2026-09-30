// Style D, level 3 theme "thalassa": warm and open, slightly lifted. D minor (i - VI - III - VII, the major chords carry the glow),
// 122 BPM, 32 bars. Soft pluck arpeggio, open pad voicings and a quiet bell motif.
import { makeMelodic, expand } from './shared/track.js';
import { makeChord, ladderPick } from './shared/util.js';

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
const chords = { Dm: C(2, 'm9'), Bb: C(10, 'M7'), F: C(5, 'M'), C: C(0, 'M'), Gm: C(7, 'm') };
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;

const track = makeMelodic({
  id: 'd-thalassa', name: 'Thalassa (melodic techno)', seed: 33, bpm: 122,
  description: 'Warm open melodic techno in D minor: soft pluck arpeggio, wide pad voicings and a quiet bell motif.',
  chords,
  progression: [...expand('Dm Bb'), ...expand('Dm Bb F C'), ...expand('Bb F Gm C'), ...expand('Dm Bb F C'), ...expand('Dm C')],
  sections: [
    ['intro', 4, 'kick hat pad arp'],
    ['groove', 8, 'kick hat oh shaker clap bass arp pad motif tick'],
    ['break', 8, 'pad arp motif swell'],
    ['drop', 8, 'kick hat oh shaker clap bass arp pad motif tick rim'],
    ['outro', 4, 'kick hat oh bass arp pad shaker'],
  ],
  arc: [[0, 0.25], [4, 0.4], [12, 0.75], [12.001, 0.4], [20, 0.85], [20.001, 1], [28, 1], [32, 0.25]],
  lp: [[0, 2000], [4, 5500], [4.001, 5500], [12, 13000], [12.001, 1100], [19.9, 10000], [20, 15000], [28, 15000], [32, 2000]],
  rig: { trim: 0.2, seed: 33, revSec: 4.6, revLevel: 0.34, duckDepth: 0.4, levels: { kick: 0.85, drums: 1, bass: 1.2, pad: 0.5, arp: 1.5, lead: 1.6 } },
  kick: { f0: 158, f1: 68, len: 0.44, drive: 1.8, click: 0.18 },
  drumStyle: { hatVol: 0.1, percPat: '..x...x..x...x..' },
  perc: (rig, t, v, s, bar, { G }) => {
    if (G('tick') > 0.05) rig.metal(t, 2800 + 300 * ((s + bar) % 3), v * 2.3 * G('tick'), { dec: 0.03, vol: 0.09, cut: 5500, q: 1.3 });
  },
  bass: { pat: (sec, bar, e) => (sec.name === 'drop' || e > 0.65 ? '.rrf.rr..rrf.rrf' : '..r...r...r...f.'), cut: [180, 480], vol: 0.15, len: 0.7, env: 2.0, voice: { oscs: [{ type: 'sine', gain: 1 }, { type: 'triangle', oct: 1, gain: 0.25 }, { type: 'sawtooth', det: -5, gain: 0.18 }] } },
  arp: {
    patterns: [
      [[0, 0], [2, 2], [4, 1], [6, 3], [8, 2], [10, 4], [12, 3], [14, 1]],
      [[0, 0], [2, 2], [3, 1], [6, 3], [8, 1], [10, 4], [12, 2], [14, 5]],
    ],
    cut: [600, 1500], vol: 0.075, env: 2.0, dec: 0.16, q: 1.6, rev: 0.14,
    voice: { oscs: [{ type: 'triangle', gain: 0.8 }, { type: 'sawtooth', det: -6, gain: 0.35 }], q: 1.6 },
  },
  pad: { cut: [450, 1250], vol: 0.06, rev: 0.55, notes: (ch) => [ch.bass + 12, ch.bass + 19, ...ch.pad, ch.pad[1] + 12] },
  motif: {
    vol: 0.042, rel: 1.3,
    notes: (ch, bar) => (bar % 2 === 0 ? [[2, L(ch, 5), 4], [8, L(ch, 3), 4], [12, L(ch, 4), 8]] : null),
  },
  impact: 0.6,
});
export const { meta, create, SCORE } = track;
