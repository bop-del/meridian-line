// Style D (melodic techno) title theme: the config for the shared builder in ../../styles/d/shared/track.js.
// A minor (i - VI - III - VII and friends that never fully resolve), 124 BPM, 32 bars, a fixed arrangement (no intensity layers).
// A patient build: pad and a pluck introduce the motif, then the bass and the rolling groove arrive, a break with real silence,
// the drop, and an outro that leads back into the intro.
import { expand } from '../../styles/d/shared/track.js';
import { makeChord, ladderPick } from '../../styles/d/shared/util.js';

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
export const chords = { Am: C(9, 'm9'), F: C(5, 'M7'), C: C(0, 'M'), G: C(7, 'M'), Dm: C(2, 'm') };
export const progression = [...expand('Am F'), ...expand('Am F C G'), ...expand('F C Dm G'), ...expand('Am F C G'), ...expand('Am G')];
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;

export const sections = [
  ['intro', 4, 'kick hat pad arp motif'],
  ['groove', 8, 'kick hat oh shaker clap bass arp pad motif tick'],
  ['break', 8, 'pad arp motif swell'],
  ['drop', 8, 'kick hat oh shaker clap bass arp pad motif tick rim tom'],
  ['outro', 4, 'kick hat oh bass arp pad shaker'],
];

// Main motif: four sparse notes every second bar, following the chord tones
export const motif = (ch, bar) => (bar % 2 === 0 ? [[0, L(ch, 4), 3], [6, L(ch, 2), 3], [10, L(ch, 3), 3], [13, L(ch, 5), 6]] : null);

// Pluck arpeggio patterns: [step, index into the chord tones]
export const arpPatterns = [
  [[0, 0], [2, 2], [4, 1], [6, 3], [8, 2], [10, 4], [12, 3], [14, 1]],
  [[0, 0], [1, 2], [3, 1], [4, 3], [6, 2], [8, 0], [9, 2], [11, 1], [12, 3], [14, 4]],
];
