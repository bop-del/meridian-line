// Style D, level 2 theme "cinder": tense and syncopated but restrained. C minor with a flat second colour, 124 BPM, 32 bars.
// A 3-3-2 pluck arpeggio into a dotted eighth echo over a nervous offbeat bass, cold ticks, dark pad.
import { makeMelodic, expand } from './shared/track.js';
import { makeChord, ladderPick } from './shared/util.js';

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
const chords = { Cm: C(0, 'm'), Db: C(1, 'M7'), Bb: C(10, 'M'), Ab: C(8, 'M'), Gm: C(7, 'm') };
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;

const track = makeMelodic({
  id: 'd-cinder', name: 'Cinder (melodic techno)', seed: 21, bpm: 124,
  description: 'Tense melodic techno in C minor: a syncopated 3-3-2 pluck arpeggio, flat second colour, nervous but restrained bass.',
  chords,
  progression: [...expand('Cm Db'), ...expand('Cm Db Cm Bb'), ...expand('Ab Bb Db Gm'), ...expand('Cm Db Ab Bb'), ...expand('Cm Bb')],
  sections: [
    ['intro', 4, 'kick hat pad arp tick'],
    ['groove', 8, 'kick hat oh shaker clap bass arp pad tick motif'],
    ['break', 8, 'pad arp motif swell tick'],
    ['drop', 8, 'kick hat oh shaker clap bass arp pad tick rim tom motif'],
    ['outro', 4, 'kick hat oh bass arp pad shaker'],
  ],
  arc: [[0, 0.2], [4, 0.35], [12, 0.7], [12.001, 0.3], [20, 0.85], [20.001, 1], [28, 1], [32, 0.2]],
  lp: [[0, 1600], [4, 4500], [4.001, 4500], [12, 11000], [12.001, 900], [19.9, 8500], [20, 14000], [28, 14000], [32, 1600]],
  rig: { trim: 0.2, seed: 21, revSec: 4.0, revLevel: 0.3, duckDepth: 0.38, levels: { kick: 0.9, drums: 1, bass: 1.2, pad: 0.6, arp: 2, lead: 1.5 } },
  kick: { f0: 160, f1: 66, len: 0.44, drive: 1.9, click: 0.22 },
  drumStyle: { percPat: '.x...x..x...x..x' },
  perc: (rig, t, v, s, bar, { G }) => {
    if (G('tick') > 0.05) rig.metal(t, 2300 + 400 * ((s + bar) % 3), v * 2.04 * G('tick'), { dec: 0.03, vol: 0.11, cut: 5200, q: 1.5 });
    if (G('tom') > 0.05 && s === 14 && bar % 2) rig.tom(t, 100, v * G('tom'), 0.35, 0.2);
  },
  bass: { pat: (sec, bar, e) => (sec.name === 'drop' || e > 0.7 ? '..r..f.r..r.f..r' : '..r...r...r..fr.'), cut: [170, 420], vol: 0.15, len: 0.6, env: 2.2 },
  arp: {
    patterns: [
      [[0, 0], [3, 2], [6, 1], [8, 3], [11, 'b2'], [14, 2]],
      [[0, 1], [3, 3], [6, 2], [8, 4], [11, 3], [14, 'b2']],
    ],
    cut: [480, 1200], vol: 0.085, env: 2.3, dec: 0.14, q: 2.8, len: 0.75, rev: 0.12,
    sends: { rev: 0.12, del: 0.75 },
  },
  pad: { cut: [360, 950], vol: 0.055 },
  motif: { vol: 0.07, notes: (ch, bar) => (bar % 4 === 2 ? [[0, L(ch, 4), 5], [7, L(ch, 3), 4], [12, L(ch, 4), 6]] : null) },
  impact: 0.7,
});
export const { meta, create, SCORE } = track;
