// Style D, level 1 theme "foundry": the darkest and most industrial track, still melodic. E phrygian, 122 BPM, 32 bars.
// Rolling sub bass, a cold square pluck arpeggio that leans on the flat second, metallic ticks, pad drones and a heavy soft kick.
import { makeMelodic, expand } from './shared/track.js';
import { makeChord, ladderPick } from './shared/util.js';

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
const chords = { Em: C(4, 'm'), F: C(5, 'M'), D: C(2, 'sus2'), Dm: C(2, 'm'), C: C(0, 'M') };
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;
const TICK_F = [1900, 2600, 2150, 3100];

const track = makeMelodic({
  id: 'd-foundry', name: 'Foundry (melodic techno)', seed: 11, bpm: 122,
  description: 'Dark industrial melodic techno in E phrygian: rolling sub bass, a cold pluck arpeggio, metallic ticks and pad drones.',
  fixed: false,
  chords,
  progression: [...expand('Em F'), ...expand('Em F Em D'), ...expand('F D Dm Em'), ...expand('Em F C D'), ...expand('Em F')],
  sections: [
    ['intro', 4, 'kick hat pad drone arp tick'],
    ['groove', 8, 'kick hat oh shaker clap bass arp pad drone tick motif'],
    ['break', 8, 'pad drone arp motif swell tick'],
    ['drop', 8, 'kick hat oh shaker clap bass arp pad drone tick rim tom motif'],
    ['outro', 4, 'kick hat oh bass arp pad drone'],
  ],
  arc: [[0, 0.2], [4, 0.3], [12, 0.65], [12.001, 0.3], [20, 0.8], [20.001, 1], [28, 1], [32, 0.2]],
  lp: [[0, 1400], [4, 4000], [4.001, 4000], [12, 10000], [12.001, 800], [19.9, 8000], [20, 14000], [28, 14000], [32, 1400]],
  rig: { trim: 0.174, seed: 11, revSec: 4.4, revLevel: 0.3, duckDepth: 0.36, levels: { kick: 0.9, drums: 1, bass: 1.3, pad: 0.6, arp: 1.4, lead: 1.5, drone: 0.4 } },
  kick: { f0: 155, f1: 60, len: 0.5, drive: 2.1, click: 0.22, sweepT: 0.05, hold: 0.45 },
  drumStyle: { hatVol: 0.11, percPat: '..x..x.x..x..x.x' },
  drums: (sec, bar, e) => (sec.name === 'outro' ? { ohPat: '..x.......x.....' } : {}),
  perc: (rig, t, v, s, bar, { G, rnd }) => {
    if (G('tick') > 0.05 && s % 4 !== 0) rig.metal(t, TICK_F[(s + bar) % 4], v * 2.38 * G('tick'), { dec: 0.035, vol: 0.12, cut: 4800, q: 1.4 });
    if (G('tom') > 0.05 && (s === 7 || s === 15) && bar % 2) rig.tom(t, 88, v * G('tom'), 0.4, 0.22);
  },
  bass: {
    pat: (sec, bar, e) => (sec.name === 'drop' || (sec.name === 'groove' && sec.i >= 4) || e > 0.8 ? '.rrf.rrr.rfr.rrf' : '..r...r...r...f.'),
    cut: [150, 380], vol: 0.15, len: 0.65, env: 2, q: 1.6, voice: { oscs: [{ type: 'sine', gain: 1.1 }, { type: 'sawtooth', det: -4, gain: 0.22 }], q: 1.6 },
  },
  arp: {
    patterns: [
      [[0, 0], [1, 0], [3, 2], [4, 1], [6, 3], [8, 2], [9, 2], [10, 'b2'], [12, 3], [14, 1]],
      [[0, 0], [2, 1], [3, 2], [6, 'b2'], [8, 3], [10, 1], [11, 2], [14, 4]],
    ],
    cut: [420, 1000], vol: 0.075, env: 2.1, dec: 0.13, q: 2.6, rev: 0.12,
    voice: { oscs: [{ type: 'square', det: -6, gain: 0.6 }, { type: 'square', det: 6, gain: 0.5 }], q: 2.6 },
  },
  pad: { cut: [330, 900], vol: 0.055, rev: 0.45, atk: 1.6 },
  drone: { vol: 0.06, cut: 260 },
  motif: {
    vol: 0.075,
    notes: (ch, bar) => (bar % 4 === 0 ? [[0, L(ch, 4), 4], [6, L(ch, 3), 4], [11, L(ch, 5), 8]] : null),
  },
  impact: 0.8,
});
export const { meta, create, SCORE } = track;
